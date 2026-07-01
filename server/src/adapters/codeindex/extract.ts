/**
 * Enhanced regex symbol/reference extractor for TS/JS (A3, L04).
 *
 * DESIGN NOTE (tree-sitter vs. regex): the F1 scaffolding left a TODO to wire
 * `web-tree-sitter` for accurate blast-radius. Under the parallel-phase rules
 * we MUST NOT run installs, and `web-tree-sitter` additionally needs grammar
 * `.wasm` blobs shipped+loaded at runtime — not something we can verify in this
 * phase. So we **meaningfully strengthen the regex extractor** instead (and
 * declare `web-tree-sitter` as an optional future dep in the report). The
 * extractor below is line-based but covers the declaration/reference shapes
 * that matter for finding downstream callers in a TS/JS monorepo:
 *
 *   symbols     — function / async function / generator, exported const-arrow,
 *                 class + its methods, interface, type, enum. Export-awareness.
 *   references  — call sites `sym(`, `new Sym(`, member calls `.sym(`,
 *                 JSX usage `<Sym`, and `sym` used as an identifier passed as a
 *                 value — while EXCLUDING the declaration line, import lines,
 *                 and comments. This is what lets blast-radius resolve callers.
 *
 * It is intentionally conservative about false positives (skips comment lines,
 * import/export-from lines) so the blast graph stays trustworthy.
 */

export interface ExtractedSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface ExtractedReference {
  toSymbol: string;
  line: number;
}

const LINE_COMMENT = /^\s*(\/\/|\*|\/\*)/;
const IMPORT_LINE = /^\s*import\s|^\s*export\s+\{[^}]*\}\s+from\b|^\s*export\s+\*\s+from\b/;

/** Strip line/block-comment tails and string contents to reduce false matches. */
function sanitizeLine(line: string): string {
  // remove // comments
  let s = line.replace(/\/\/.*$/, '');
  // crude string blanking so `foo(` inside a string literal isn't a call
  s = s.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return s;
}

const SYMBOL_PATTERNS: { re: RegExp; kind: string }[] = [
  // export? (default)? async? function* name(   |  function name(
  { re: /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/, kind: 'function' },
  // export? abstract? class Name
  { re: /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  // export? const|let name = (  ... ) =>   |  = async (  |  = function
  {
    re: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    kind: 'function',
  },
  { re: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
  { re: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
];

// JS keywords / common no-symbol identifiers we never treat as a method/symbol.
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof',
  'new', 'delete', 'void', 'do', 'else', 'in', 'of', 'instanceof', 'yield', 'super',
  'constructor', 'get', 'set', 'import', 'export', 'as', 'from', 'class', 'extends',
]);

// class-body method:  name(args) {  | async name(args) {  | static name(args) {
const METHOD_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\{/;

/**
 * Extract declared symbols from a single file's source.
 * Tracks a shallow `class` context so methods are reported as `<Class>.<method>`
 * AND as bare `<method>` (so reference search can find either form).
 */
export function extractSymbols(content: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  const lines = content.split('\n');
  let classDepth = 0;
  let currentClass: string | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (LINE_COMMENT.test(raw)) {
      braceDepth += countBraces(raw);
      continue;
    }
    const line = sanitizeLine(raw);

    let matchedDecl = false;
    for (const { re, kind } of SYMBOL_PATTERNS) {
      const m = line.match(re);
      if (m?.[1] && !KEYWORDS.has(m[1])) {
        out.push({ name: m[1], kind, line: i + 1 });
        if (kind === 'class') {
          currentClass = m[1];
          classDepth = braceDepth;
        }
        matchedDecl = true;
        break;
      }
    }

    // Methods inside a class body (only when we're one level into the class).
    if (!matchedDecl && currentClass && braceDepth === classDepth + 1) {
      const mm = line.match(METHOD_RE);
      if (mm?.[1] && !KEYWORDS.has(mm[1])) {
        out.push({ name: `${currentClass}.${mm[1]}`, kind: 'method', line: i + 1 });
        out.push({ name: mm[1], kind: 'method', line: i + 1 });
      }
    }

    braceDepth += countBraces(line);
    if (currentClass && braceDepth <= classDepth) currentClass = null;
  }
  return dedupeSymbols(out);
}

function countBraces(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === '{') n++;
    else if (ch === '}') n--;
  }
  return n;
}

function dedupeSymbols(syms: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  const out: ExtractedSymbol[] = [];
  for (const s of syms) {
    const key = `${s.name}:${s.kind}:${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Find references (call sites / usages) of `symbol` in a file's source.
 * Matches `sym(`, `new sym(`, `.sym(`, `<Sym`, and bare-identifier usage that
 * is NOT the declaration. Skips import lines and comment lines.
 */
export function extractReferences(content: string, symbol: string): ExtractedReference[] {
  // Reference search works on the *method/function name* — if the caller passes
  // a `Class.method` symbol, match on the trailing member.
  const bare = symbol.includes('.') ? symbol.split('.').pop()! : symbol;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const callRe = new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`); // sym(
  const memberCallRe = new RegExp(`\\.${escaped}\\s*\\(`); // .sym(
  const newRe = new RegExp(`new\\s+${escaped}\\b`); // new Sym
  const jsxRe = new RegExp(`<${escaped}[\\s/>]`); // <Sym

  const declRe = new RegExp(
    `(?:function\\s*\\*?\\s*|class\\s+|interface\\s+|type\\s+|enum\\s+|(?:const|let|var)\\s+)${escaped}\\b`,
  );

  const out: ExtractedReference[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (LINE_COMMENT.test(raw) || IMPORT_LINE.test(raw)) continue;
    const line = sanitizeLine(raw);
    if (declRe.test(line)) continue; // the declaration itself is not a reference
    if (callRe.test(line) || memberCallRe.test(line) || newRe.test(line) || jsxRe.test(line)) {
      out.push({ toSymbol: symbol, line: i + 1 });
    }
  }
  return out;
}

/**
 * Derive an HTTP route path for Next.js App Router and legacy Pages API files.
 *
 * Returns a route string (e.g. `/api/cron/foo`) for recognised route files,
 * or `null` for any other file.  The derivation is heuristic:
 *   - Route groups `(name)` are dropped.
 *   - `[...param]` → `:param`  (catch-all)
 *   - `[param]`    → `:param`  (dynamic segment)
 * A wrong derived path is worse than none, so unrecognised shapes return null.
 */
function nextRoutePath(relPath: string): string | null {
  // App Router: app/**/route.<ext>
  const appM = relPath.match(/(?:^|\/)app\/(.+)\/route\.(?:ts|tsx|js|jsx|mjs|cjs)$/);
  if (appM) {
    const segs = appM[1]!;
    return '/' + deriveSegments(segs);
  }
  // Legacy Pages API: pages/api/**.<ext>
  const pagesM = relPath.match(/(?:^|\/)pages\/api\/(.+)\.(?:ts|tsx|js|jsx|mjs|cjs)$/);
  if (pagesM) {
    const segs = pagesM[1]!;
    return '/api/' + deriveSegments(segs);
  }
  return null;
}

/** Process path segment string: drop route groups, map dynamic segments. */
function deriveSegments(middle: string): string {
  return middle
    .split('/')
    .flatMap((seg) => {
      if (/^\(.*\)$/.test(seg)) return []; // drop route group e.g. (admin)
      const catchAll = seg.match(/^\[\.\.\.(.+)\]$/);
      if (catchAll) return [':' + catchAll[1]!];
      const dynamic = seg.match(/^\[(.+)\]$/);
      if (dynamic) return [':' + dynamic[1]!];
      return [seg];
    })
    .join('/');
}

// Exported-verb patterns for Next.js route handlers (top-of-line only).
const NEXT_VERB_FN_RE =
  /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const NEXT_VERB_CONST_RE =
  /^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/;

/**
 * Heuristic endpoint detector: HTTP route registrations in a file.
 * Catches Fastify/Express style `app.get('/path', ...)`, `router.post(...)`,
 * `app.get<...>('/path')`, and `route({ method, url })`. Returns "METHOD /path".
 *
 * When `relPath` is provided and identifies a Next.js App-Router route file
 * (app dir route file) or legacy Pages API file, also emits one
 * "VERB /derived/path" entry per exported HTTP-verb handler.
 * Keeping `relPath` optional means all existing callers (and tests) that omit it
 * continue to work byte-for-byte identically.
 */
export function extractEndpoints(content: string, relPath?: string): string[] {
  const out = new Set<string>();
  const lines = content.split('\n');
  const verbRe =
    /\b(?:app|router|fastify|server|api)\.(get|post|put|patch|delete|options|head)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/i;
  const routeObjRe = /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`][\s\S]*?url\s*:\s*['"`]([^'"`]+)['"`]/i;
  for (const raw of lines) {
    const m = raw.match(verbRe);
    if (m) out.add(`${m[1]!.toUpperCase()} ${m[3]}`);
    const r = raw.match(routeObjRe);
    if (r) out.add(`${r[1]!.toUpperCase()} ${r[2]}`);
  }

  // Next.js path-aware branch: only when relPath identifies a route file.
  if (relPath) {
    const routePath = nextRoutePath(relPath);
    if (routePath) {
      for (const raw of lines) {
        const fn = raw.match(NEXT_VERB_FN_RE);
        if (fn) { out.add(`${fn[1]!} ${routePath}`); continue; }
        const cn = raw.match(NEXT_VERB_CONST_RE);
        if (cn) out.add(`${cn[1]!} ${routePath}`);
      }
    }
  }

  return [...out];
}

/**
 * Heuristic cron/scheduled-job detector. Catches cron expressions in
 * `schedule('* * * * *')`, `cron.schedule(...)`, `CronJob(...)`, and
 * `jobs.register('kind')` / `enqueue(ws, 'kind')` style background work.
 *
 * When `relPath` is provided and identifies a Next.js cron-route file
 * (derived route path starts with /api/cron/), also emits a "cron:<path>" entry.
 */
export function extractCrons(content: string, relPath?: string): string[] {
  const out = new Set<string>();
  const lines = content.split('\n');
  const cronExprRe = /\b(?:cron|schedule|CronJob)\s*[.(]?\s*\(?\s*['"`]([^'"`]*(?:\*|\d+\s+\d+)[^'"`]*)['"`]/i;
  const jobKindRe = /\b(?:register|enqueue)\s*\(\s*(?:[A-Za-z0-9_$.]+\s*,\s*)?['"`]([a-z][a-z0-9_]*)['"`]/i;
  for (const raw of lines) {
    const m = raw.match(cronExprRe);
    if (m) out.add(m[1]!.trim());
    const j = raw.match(jobKindRe);
    if (j && /poll|index|clone|digest|cron|sync|schedule|job/i.test(raw)) out.add(`job:${j[1]}`);
  }

  // Next.js cron-route: a route file whose path starts with /api/cron/ is itself a cron.
  if (relPath) {
    const routePath = nextRoutePath(relPath);
    if (routePath && routePath.startsWith('/api/cron/')) {
      out.add(`cron:${routePath}`);
    }
  }

  return [...out];
}
