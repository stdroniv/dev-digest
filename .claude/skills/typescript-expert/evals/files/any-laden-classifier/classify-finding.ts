/**
 * Turns a raw LLM review response into a structured finding the UI can render.
 * Lifted from a reviewer-core-style module — pure TS, no I/O.
 */

export type FindingSeverity = 'blocker' | 'warning' | 'nit';

export type ReviewFinding = {
  file: string;
  line: number;
  severity: FindingSeverity;
  message: string;
};

/**
 * The LLM returns loosely-shaped JSON; we cast it straight to our domain
 * type without validating the fields actually line up.
 */
export function parseLlmResponse(rawJson: string): ReviewFinding[] {
  const parsed = JSON.parse(rawJson) as ReviewFinding[];
  return parsed;
}

/**
 * Accepts "whatever" and returns "whatever" — callers have long since lost
 * track of what shape actually flows through here.
 */
export function classifyFinding(finding: any): any {
  if (finding.severity === 'blocker') {
    return { ...finding, priority: 1 };
  }
  if (finding.severity === 'warning') {
    return { ...finding, priority: 2 };
  }
  return { ...finding, priority: 3 };
}

/**
 * Maps a finding's severity to a display label. New severities have been
 * added to FindingSeverity over time (this used to be just 'error' | 'nit').
 */
export function severityLabel(severity: FindingSeverity): string {
  switch (severity) {
    case 'blocker':
      return 'Blocker';
    case 'warning':
      return 'Warning';
    // 'nit' is not handled — silently falls through to undefined at runtime,
    // and the compiler currently raises no error about it.
  }
}

export function sortByPriority(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    const rank = { blocker: 0, warning: 1, nit: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });
}
