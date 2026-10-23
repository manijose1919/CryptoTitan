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
 * while live generateSignals also requires MIN_CONFIDENCE (0.60 as of 2026-10-21).
 */
describe('multiStrategy TREND MIN_CONFIDENCE parity', () => {
  const strategy = STRATEGY_CONFIGS.TREND;
  const candles = [{ time: Date.UTC(2026, 5, 15, 12, 0, 0), open: 1, high: 1, low: 1, close: 100, volume: 1 }];
  const signals = {
    close_price: 100,
    atr_percent: 2,
    volume_ratio: 0.5,
    macd_histogram: 1,
    sr_channel_position: 0.5,
    bb_percent_b: 0.7,
    tc_value: 50,
  };
  const regime = { regime: 'STRONG_UP', trendMaturity: 40, confidence: 0.8 } as any;

  beforeEach(() => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReset();
  });

  it('rejects score 58 / conf 0.58 (passes boosted score floor, fails live confidence)', () => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReturnValue({
      compositeScore: 58,
      confidence: 0.58,
      tcVeto: false,
      bbPenalized: false,
    });
    const r = detectEntry(strategy, candles as any, signals as any, regime);
    expect(r.shouldEnter).toBe(false);
    expect(V2_CONFIG.MIN_CONFIDENCE).toBe(0.6);
  });

  it('admits score 60 / conf 0.60', () => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReturnValue({
      compositeScore: 60,
      confidence: 0.6,
      tcVeto: false,
      bbPenalized: false,
    });
    const r = detectEntry(strategy, candles as any, signals as any, regime);
    expect(r.shouldEnter).toBe(true);
    expect(r.confidence).toBe(0.6);
    expect(r.metadata.compositeScore).toBe(60);
  });

  it('rejects thin volume_ratio below paper MIN_SIGNAL_VOLUME_RATIO=0.20', () => {
    vi.mocked(applyLongTrendScoreAdjustments).mockReturnValue({
      compositeScore: 60,
      confidence: 0.6,
      tcVeto: false,
      bbPenalized: false,
    });
    const thin = { ...signals, volume_ratio: 0.16 };
    const r = detectEntry(strategy, candles as any, thin as any, regime);
    expect(r.shouldEnter).toBe(false);
    expect((V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO).toBe(0.2);
  });
});
