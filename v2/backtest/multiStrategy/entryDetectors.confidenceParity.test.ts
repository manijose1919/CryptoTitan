import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2_CONFIG } from '../../engine/config.ts';
import { STRATEGY_CONFIGS } from './strategyRegistry.ts';

vi.mock('../../pipeline/signalGenerator.ts', () => ({
  evaluateSignals: vi.fn(() => [{ name: 'rsi', weight: 1, score: 60, active: true }]),
}));

vi.mock('../../pipeline/trendScoreAdjustments.ts', () => ({
  applyLongTrendScoreAdjustments: vi.fn(),
}));

vi.mock('../../pipeline/timeGate.ts', () => ({
  checkTimeGate: vi.fn(() => ({ allow: true, scoreBoost: 5, reason: 'boosted' })),
}));

import { applyLongTrendScoreAdjustments } from '../../pipeline/trendScoreAdjustments.ts';
import { detectEntry } from './entryDetectors.ts';

/**
 * multiStrategy TREND previously gated only on minCompositeScore (60) + TimeGate boost,
 * while live generateSignals also requires MIN_CONFIDENCE=0.65.
 */
describe('multiStrategy TREND MIN_CONFIDENCE parity', () => {
  const strategy = STRATEGY_CONFIGS.TREND;
  const candles = [{ time: Date.UTC(2026, 5, 15, 12, 0, 0), open: 1, high: 1, low: 1, close: 100, volume: 1 }];
  const signals = {
    close_price: 100,
    atr_percent: 2,
    macd_histogram: 1,
    sr_channel_position: 0.5,
    bb_percent_b: 0.7,
    tc_value: 50,
  };
  const regime = { regime: 'STRONG_UP', trendMaturity: 40, confidence: 0.8 } as any;

  beforeEach(() => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReset();
  });

  it('rejects score 62 / conf 0.62 (passes boosted score floor, fails live confidence)', () => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReturnValue({
      compositeScore: 62,
      confidence: 0.62,
      tcVeto: false,
      bbPenalized: false,
    });
    const r = detectEntry(strategy, candles as any, signals as any, regime);
    expect(r.shouldEnter).toBe(false);
    expect(V2_CONFIG.MIN_CONFIDENCE).toBe(0.65);
  });

  it('admits score 65 / conf 0.65', () => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReturnValue({
      compositeScore: 65,
      confidence: 0.65,
      tcVeto: false,
      bbPenalized: false,
    });
    const r = detectEntry(strategy, candles as any, signals as any, regime);
    expect(r.shouldEnter).toBe(true);
    expect(r.confidence).toBe(0.65);
    expect(r.metadata.compositeScore).toBe(65);
  });
});
