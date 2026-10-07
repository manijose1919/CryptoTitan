import { describe, expect, it } from 'vitest';
import {
  CONTAMINATED_TRADE_IDS,
  filterCohortTrades,
  isContaminatedTradeId,
  isMainPipelineStrategy,
} from './cohortScope.ts';

describe('cohortScope', () => {
  it('includes TREND/MOMENTUM/BREAKOUT and excludes sniper', () => {
    expect(isMainPipelineStrategy('TREND')).toBe(true);
    expect(isMainPipelineStrategy('MOMENTUM')).toBe(true);
    expect(isMainPipelineStrategy('BREAKOUT')).toBe(true);
    expect(isMainPipelineStrategy('SNIPER_KRAKEN')).toBe(false);
    expect(isMainPipelineStrategy('MEAN_REVERSION')).toBe(false);
  });

  it('flags contaminated AVAX MOMENTUM id', () => {
    expect(isContaminatedTradeId('f69f31c0-ae44-4c4f-b7c2-901bb279b35a')).toBe(true);
    expect(CONTAMINATED_TRADE_IDS.has('f69f31c0-ae44-4c4f-b7c2-901bb279b35a')).toBe(true);
    expect(isContaminatedTradeId('clean-id')).toBe(false);
  });

  it('filterCohortTrades drops sniper and contaminated rows', () => {
    const rows = [
      { id: 'a', strategy: 'TREND' },
      { id: 'f69f31c0-ae44-4c4f-b7c2-901bb279b35a', strategy: 'MOMENTUM' },
      { id: 'b', strategy: 'MOMENTUM' },
      { id: 'c', strategy: 'SNIPER_KRAKEN' },
    ];
    expect(filterCohortTrades(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
