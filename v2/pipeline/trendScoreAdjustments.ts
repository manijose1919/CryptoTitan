/**
 * Shared long-TREND composite post-adjustments (live ↔ backtest parity).
 *
 * Live `generateSignals` historically applied MACD / SR / BB>0.95 / TC / maturity
 * after the weighted eval average. `backtestEngine` drifted to a harsher BB>0.80
 * formula and omitted MACD/SR/TC — research baselines were not paper-faithful.
 */
import { V2_CONFIG } from '../engine/config.ts';

export type TrendScoreSignals = {
  macd_histogram?: number;
  sr_channel_position?: number;
  bb_percent_b?: number;
  tc_value?: number;
};

export type TrendScoreRegime = {
  regime: string;
  trendMaturity: number;
};

export type TrendScoreAdjustmentResult = {
  compositeScore: number;
  confidence: number;
  tcVeto: boolean;
  bbPenalized: boolean;
};

/** Pure BB stretch penalty — live uses extreme overextension only (>0.95). */
export function bbStretchPenalty(pctB: number): number {
  if (!(pctB > 0.95)) return 0;
  return Math.round(10 + (pctB - 0.95) * 200);
}

/** Pure S/R channel stretch penalty (>0.85). */
export function srStretchPenalty(srPos: number): number {
  if (!(srPos > 0.85)) return 0;
  return Math.round(5 + (srPos - 0.85) * 40);
}

/**
 * Apply regime bonus + live long-TREND gates to a weighted-eval composite.
 * Does not apply TimeGate / min-score / min-confidence thresholds.
 */
export function applyLongTrendScoreAdjustments(
  baseScore: number,
  signals: TrendScoreSignals,
  regime: TrendScoreRegime,
): TrendScoreAdjustmentResult {
  let compositeScore = baseScore;

  if (regime.regime === 'STRONG_UP') compositeScore += 8;
  else if (regime.regime === 'UP') compositeScore += 2;
  else if (regime.regime === 'PULLBACK_UP') compositeScore += 3;

  compositeScore = Math.min(compositeScore, 100);

  const macdHistPositive = (signals.macd_histogram as number) > 0;
  if (!macdHistPositive) {
    compositeScore -= 8;
  }

  const srPos = signals.sr_channel_position ?? 0.5;
  compositeScore -= srStretchPenalty(srPos);

  const pctB = signals.bb_percent_b as number;
  const bbPen = bbStretchPenalty(pctB);
  const bbPenalized = bbPen > 0;
  compositeScore -= bbPen;

  const tcVal = signals.tc_value ?? 50;
  const tcVeto = tcVal >= 80;
  if (tcVeto) {
    compositeScore -= 30;
  }

  if (regime.trendMaturity > V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD) {
    const excess = regime.trendMaturity - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
    const maxExcess = 100 - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
    compositeScore -= Math.round((excess / maxExcess) * V2_CONFIG.TREND_MATURITY_MAX_PENALTY);
  }

  return {
    compositeScore,
    confidence: compositeScore / 100,
    tcVeto,
    bbPenalized,
  };
}
