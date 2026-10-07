/**
 * Main-pipeline cohort scope for monitor KPIs.
 *
 * TREND + MOMENTUM (+ BREAKOUT) share tradeEngine. Sniper/MR stay excluded.
 * Contaminated soak artifacts are dropped from headline KPIs / equity curve
 * but still appear in recentClosed (all-strategy table).
 */

export const MAIN_PIPELINE_STRATEGIES = ['TREND', 'MOMENTUM', 'BREAKOUT'] as const;

/** Paper soak artifacts — do not use for promote / cohort KPIs. */
export const CONTAMINATED_TRADE_IDS = new Set<string>([
  // 2026-10-06: MOMENTUM filled AVAX while TREND ADX-blocked (ADX 15.2); no confirm.
  'f69f31c0-ae44-4c4f-b7c2-901bb279b35a',
  // 2026-10-04: SOL skip-bar confirm after VM suspend (pre current baseline).
  'b85eef8b-a000-49e5-8a45-9f3aff5d23b0',
]);

export function isMainPipelineStrategy(strategy: string | undefined | null): boolean {
  return MAIN_PIPELINE_STRATEGIES.includes(
    (strategy ?? 'TREND') as (typeof MAIN_PIPELINE_STRATEGIES)[number],
  );
}

export function isContaminatedTradeId(id: string | undefined | null): boolean {
  return !!id && CONTAMINATED_TRADE_IDS.has(id);
}

/** Filter closed trades into the headline cohort. */
export function filterCohortTrades<T extends { id?: string; strategy?: string }>(
  trades: T[],
): T[] {
  return trades.filter(
    (t) => isMainPipelineStrategy(t.strategy) && !isContaminatedTradeId(t.id),
  );
}
