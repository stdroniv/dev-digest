/**
 * One case's latest scored run — the minimal shape `aggregate` needs to fold
 * the set's latest per-case records into a set-level (run-group) aggregate.
 * `pass` is decided by the caller (service layer) from the per-case metrics
 * (e.g. recall === 1 && precision === 1); `aggregate` itself makes no policy
 * choice about what "pass" means, it only counts it.
 */
export interface PerCaseScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
}

export interface AggregateResult {
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
}

/**
 * Fold the set's latest per-case records (one per live case — AC-25: the
 * aggregate always derives from the LATEST record per case, never a second
 * persisted row) into the set-level recall/precision/citation_accuracy +
 * pass count. An empty set (a zero-case agent, AC-20) yields defined,
 * maximal metrics — never `NaN` — since there is nothing to have failed.
 */
export function aggregate(records: PerCaseScore[]): AggregateResult {
  const total = records.length;
  if (total === 0) {
    return { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 0, traces_total: 0 };
  }
  const sum = (key: 'recall' | 'precision' | 'citation_accuracy') =>
    records.reduce((s, r) => s + r[key], 0);
  const passed = records.filter((r) => r.pass).length;
  return {
    recall: sum('recall') / total,
    precision: sum('precision') / total,
    citation_accuracy: sum('citation_accuracy') / total,
    traces_passed: passed,
    traces_total: total,
  };
}
