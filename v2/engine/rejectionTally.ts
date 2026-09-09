/**
 * Count failed gate results for monitoring counters.
 */
export function tallyFailed(results: ReadonlyArray<{ passed: boolean }>): number {
  let n = 0;
  for (const r of results) {
    if (!r.passed) n += 1;
  }
  return n;
}
