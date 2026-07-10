/**
 * Shared unified-diff builder for the eval-case seeds. Both the hard AGENT
 * cases (`seed-evals-hard.ts`) and the API-contract SKILL cases
 * (`seed-evals-skills.ts`) need real, multi-file diffs whose line numbers agree
 * exactly with the scorer's own numbering — so the helper lives here, once.
 */

export type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
export type Category = 'bug' | 'security' | 'perf' | 'style' | 'test';

export interface DiffLine {
  op: '+' | '-' | ' ';
  text: string;
}

export function add(text: string): DiffLine {
  return { op: '+', text };
}
export function del(text: string): DiffLine {
  return { op: '-', text };
}
export function ctx(text: string): DiffLine {
  return { op: ' ', text };
}

export interface DiffFileSpec {
  path: string;
  oldStart: number;
  lines: DiffLine[];
}

/**
 * Builds a real multi-file unified diff and, crucially, a `lineOf` lookup that
 * mirrors the scorer's own line-numbering (`metrics.ts` `buildDiffLineIndex` /
 * `diff-parser.ts`): a `+` or context line consumes the next new-side line
 * number, a `-` line does not. Looking up the expected finding's line THIS way
 * (instead of hand-counting) guarantees the case's expectation always points at
 * a real, citable line inside the diff we actually generated.
 */
export function buildDiff(files: DiffFileSpec[]): {
  text: string;
  lineOf: (path: string, exactLine: string) => number;
} {
  const blocks: string[] = [];
  const newLineOfByFile = new Map<string, number[]>();

  for (const f of files) {
    const added = f.lines.filter((l) => l.op === '+').length;
    const removed = f.lines.filter((l) => l.op === '-').length;
    const context = f.lines.filter((l) => l.op === ' ').length;
    const oldLines = removed + context;
    const newLines = added + context;
    const body: string[] = [];
    const newLineOf: number[] = [];
    let cursor = f.oldStart;
    for (const l of f.lines) {
      body.push(`${l.op}${l.text}`);
      if (l.op === '-') {
        newLineOf.push(-1);
      } else {
        newLineOf.push(cursor);
        cursor++;
      }
    }
    newLineOfByFile.set(f.path, newLineOf);
    blocks.push(
      [
        `diff --git a/${f.path} b/${f.path}`,
        `--- a/${f.path}`,
        `+++ b/${f.path}`,
        `@@ -${f.oldStart},${oldLines} +${f.oldStart},${newLines} @@`,
        ...body,
      ].join('\n'),
    );
  }

  const lineOf = (path: string, exactLine: string): number => {
    const file = files.find((f) => f.path === path);
    if (!file) throw new Error(`buildDiff: no file "${path}" in this diff`);
    const idx = file.lines.findIndex((l) => l.text === exactLine);
    if (idx === -1) throw new Error(`buildDiff: no line matching "${exactLine}" in ${path}`);
    const newLine = newLineOfByFile.get(path)![idx]!;
    if (newLine === -1) throw new Error(`buildDiff: "${exactLine}" in ${path} is a deletion — has no new-side line`);
    return newLine;
  };

  return { text: blocks.join('\n'), lineOf };
}
