import { inflateRawSync } from 'node:zlib';

/**
 * Dependency-free import parsing for the skills "import from file/archive" flow.
 *
 * SECURITY POSTURE — a foreign skill is UNTRUSTED INPUT. We extract ONLY the
 * skill's markdown core. Executable / non-markdown archive entries (scripts,
 * binaries, configs) are never inflated, never run, and never stored — their
 * names are returned so the import drawer can show what was skipped. We also do
 * NOT persist the archive's file tree (out of scope). Nothing here writes to the
 * DB; this module is pure (Buffer in → preview out).
 */

/** Hard caps so a malicious archive can't exhaust memory. */
const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024; // 2 MiB per markdown entry
const MARKDOWN_RE = /\.(md|markdown)$/i;

export interface ParsedImport {
  /** The extracted markdown body (the skill core). */
  body: string;
  /** Suggested skill file name (archive entry path or upload filename). */
  sourceName: string;
  /** Names of archive entries that were ignored (never run / never stored). */
  ignoredFiles: string[];
}

/** True when the buffer starts with the local-file-header ZIP magic `PK\x03\x04`. */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/**
 * Parse an uploaded file into a skill body + ignored-file list. A `.zip`/archive
 * (or any PK-signed buffer) is unzipped and its primary markdown is extracted;
 * anything else is treated as a UTF-8 markdown file.
 */
export function parseImport(filename: string, buf: Buffer): ParsedImport {
  if (filename.toLowerCase().endsWith('.zip') || looksLikeZip(buf)) {
    return parseArchive(buf);
  }
  return { body: buf.toString('utf8'), sourceName: filename, ignoredFiles: [] };
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Extract the primary markdown from a ZIP archive. Only markdown entries are
 * inflated; every other entry name is collected into `ignoredFiles` and its
 * bytes are left untouched.
 */
function parseArchive(buf: Buffer): ParsedImport {
  const entries = readCentralDirectory(buf);
  const ignoredFiles: string[] = [];
  const markdown: { name: string; size: number; entry: ZipEntry }[] = [];

  for (const e of entries) {
    // Skip directory entries and anything outside our markdown allow-list.
    if (e.name.endsWith('/') || !MARKDOWN_RE.test(e.name)) {
      if (!e.name.endsWith('/')) ignoredFiles.push(e.name);
      continue;
    }
    markdown.push({ name: e.name, size: e.uncompressedSize, entry: e });
  }

  if (markdown.length === 0) {
    throw new ImportError('Archive has no markdown (.md) skill file.');
  }

  // Prefer a top-level SKILL.md, else the largest markdown file.
  markdown.sort((a, b) => {
    const aSkill = /(^|\/)skill\.md$/i.test(a.name) ? 1 : 0;
    const bSkill = /(^|\/)skill\.md$/i.test(b.name) ? 1 : 0;
    if (aSkill !== bSkill) return bSkill - aSkill;
    return b.size - a.size;
  });

  const primary = markdown[0]!;
  // The non-chosen markdown files are also left out of the stored skill.
  for (const m of markdown.slice(1)) ignoredFiles.push(m.name);

  const body = inflateEntry(buf, primary.entry);
  return { body, sourceName: primary.name, ignoredFiles };
}

/** Read the End-Of-Central-Directory record + central directory file headers. */
function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  // EOCD is at least 22 bytes; scan backward for its signature (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError('Not a valid ZIP archive.');

  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory start offset
  const CDH_SIG = 0x02014b50;
  const entries: ZipEntry[] = [];

  for (let n = 0; n < total && n < MAX_ENTRIES; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CDH_SIG) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate a single entry's bytes via its local file header. */
function inflateEntry(buf: Buffer, e: ZipEntry): string {
  if (e.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new ImportError('Skill markdown is too large.');
  }
  const lh = e.localHeaderOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new ImportError('Corrupt ZIP local header.');
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + e.compressedSize);

  if (e.method === 0) return data.toString('utf8'); // stored
  if (e.method === 8) return inflateRawSync(data).toString('utf8'); // deflate
  throw new ImportError(`Unsupported ZIP compression method ${e.method}.`);
}

/** Thrown for malformed/unsupported uploads; the route maps it to a 400. */
export class ImportError extends Error {}
