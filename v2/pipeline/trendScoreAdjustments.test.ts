import { describe, expect, it } from 'vitest';
import {
  applyLongTrendScoreAdjustments,
  bbStretchPenalty,
  srStretchPenalty,
} from './trendScoreAdjustments.ts';

describe('bbStretchPenalty (live parity)', () => {
  it('does not penalize at 0.80–0.95 (backtest used to over-penalize here)', () => {
    expect(bbStretchPenalty(0.80)).toBe(0);
    expect(bbStretchPenalty(0.94)).toBe(0);
    expect(bbStretchPenalty(0.95)).toBe(0);
  });

  it('penalizes extreme stretch >0.95 like live signalGenerator', () => {
    expect(bbStretchPenalty(0.96)).toBe(Math.round(10 + 0.01 * 200));
    expect(bbStretchPenalty(1.0)).toBe(Math.round(10 + 0.05 * 200));
  });
});

describe('srStretchPenalty', () => {
  it('starts above 0.85', () => {
    expect(srStretchPenalty(0.85)).toBe(0);
    expect(srStretchPenalty(0.9)).toBe(Math.round(5 + 0.05 * 40));
  });
});

describe('applyLongTrendScoreAdjustments', () => {
  const clean = {
    macd_histogram: 1,
    sr_channel_position: 0.5,
    bb_percent_b: 0.7,
    tc_value: 50,
  };

  it('adds STRONG_UP regime bonus', () => {
    const r = applyLongTrendScoreAdjustments(60, clean, {
      regime: 'STRONG_UP',
      trendMaturity: 40,
    });
    expect(r.compositeScore).toBe(68);
    expect(r.confidence).toBeCloseTo(0.68);
    expect(r.tcVeto).toBe(false);
    expect(r.bbPenalized).toBe(false);
  });

  it('applies MACD / BB / TC penalties like live', () => {
    const r = applyLongTrendScoreAdjustments(70, {
      macd_histogram: -0.1,
      sr_channel_position: 0.5,
      bb_percent_b: 1.0,
      tc_value: 85,
    }, { regime: 'STRONG_UP', trendMaturity: 40 });
    // 70 + 8 = 78; -8 MACD; -20 BB; -30 TC → 20
    expect(r.compositeScore).toBe(20);
    expect(r.tcVeto).toBe(true);
    expect(r.bbPenalized).toBe(true);
  });

  it('does not apply the old backtest BB>0.80 cliff at 0.90', () => {
    const r = applyLongTrendScoreAdjustments(60, {
      ...clean,
      bb_percent_b: 0.9,
    }, { regime: 'STRONG_UP', trendMaturity: 40 });
    expect(r.compositeScore).toBe(68);
  });
});
