import type { Finding } from '../findings/finding.js';

export interface Reviewer {
  name: string;
  model: string;
}

export function summarizeForReviewer(reviewer: Reviewer, findings: Finding[]): string {
  return `${reviewer.name} (${reviewer.model}) found ${findings.length} issue(s)`;
}
