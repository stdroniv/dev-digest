/**
 * Hermetic tests for the skills import parser. The security-critical behaviour:
 * a foreign archive yields ONLY its markdown core; executable / non-markdown
 * entries are ignored (never inflated, never returned as body) — just listed.
 */
import { describe, it, expect } from 'vitest';
import { parseImport, looksLikeZip, ImportError } from '../src/modules/skills/import-parse.js';

/** Build a minimal STORED (method 0) ZIP from {name → utf8 content} entries. */
function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 8); // method = stored
    local.writeUInt32LE(0, 14); // crc (ignored by parser)
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // method
    central.writeUInt32LE(0, 16); // crc
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length;
  }

  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8); // entries on disk
  eocd.writeUInt16LE(centrals.length, 10); // total entries
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16); // central dir offset
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

describe('parseImport — markdown file', () => {
  it('returns the file content verbatim with no ignored files', () => {
    const r = parseImport('rule.md', Buffer.from('# Title\nbody', 'utf8'));
    expect(r.body).toBe('# Title\nbody');
    expect(r.ignoredFiles).toEqual([]);
    expect(r.sourceName).toBe('rule.md');
  });
});

describe('parseImport — zip archive', () => {
  it('extracts the markdown core and IGNORES executable/non-markdown entries', () => {
    const zip = makeZip({
      'SKILL.md': '# Imported Skill\nrules here',
      'install.sh': 'rm -rf / # malicious',
      'index.js': 'process.exit(1)',
    });
    const r = parseImport('pack.zip', zip);
    expect(r.body).toBe('# Imported Skill\nrules here');
    // executables are surfaced as ignored, never inflated into the body
    expect(r.ignoredFiles).toContain('install.sh');
    expect(r.ignoredFiles).toContain('index.js');
    expect(r.body).not.toContain('rm -rf');
    expect(r.body).not.toContain('process.exit');
  });

  it('prefers SKILL.md, else the largest markdown', () => {
    const zip = makeZip({
      'small.md': '# tiny',
      'SKILL.md': '# the real one\nmore content',
    });
    const r = parseImport('pack.zip', zip);
    expect(r.body).toContain('the real one');
    expect(r.ignoredFiles).toContain('small.md'); // non-chosen markdown also left out
  });

  it('detects a zip by signature even with a non-.zip filename', () => {
    const zip = makeZip({ 'a.md': '# x' });
    expect(looksLikeZip(zip)).toBe(true);
    expect(parseImport('upload.bin', zip).body).toBe('# x');
  });

  it('throws ImportError when the archive has no markdown', () => {
    const zip = makeZip({ 'run.sh': 'echo hi' });
    expect(() => parseImport('pack.zip', zip)).toThrow(ImportError);
  });
});
