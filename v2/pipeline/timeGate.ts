// ============================================
// TimeGate — hour-of-day + day-of-week entry filter (2026-05-06)
// ============================================
// Data-discovered overlay applied to TREND + MOMENTUM signal generation.
//
// Pattern (validated on 132K training_trades + 137 v2 production trades):
//   * Hour 12 UTC (NY open):           best WR (66.9% / 85.7% v2)
//   * Hour 14, 17, 21 UTC:             consistently profitable
//   * Hour 13, 20 UTC:                 consistently worst (33-44% WR, large negative PnL)
//   * Friday:                           catastrophic (40.5% WR, -$9.8M training)
//   * Sunday:                           best (58.8% WR, +$8.6M training)
//
// Strategy:
//   * BLOCK signals during hard-block hours (entry rejected regardless of score)
//   * BLOCK signals on Friday (full-day veto)
//   * BOOST entries during top hours by lowering the score threshold
//   * NEUTRAL hours pass through unchanged
//
// Implementation note: takes optional timestamp arg so backtests can pass
// the candle's `time` (live engine omits → uses Date.now()).
//
// SCOPE (updated 2026-07-15): checkTimeGate is called from ALL entry detectors —
// signalGenerator.ts (TREND long+short), momentumSignal.ts, scalpSignal.ts,
// breakoutSignal.ts, meanReversionSignal.ts, and sniperSignal.ts. The last three
// were ungated until 2026-07-15 (original 2026-06-30 scope was TREND+MOMENTUM,
// whose 382-trade dataset produced the 0-7 UTC edge; extension to the others is
// mechanistic, not data-backed — see CHANGELOG 2026-07-15 for the reasoning and
// rollback).
// ============================================

export const TIME_GATE_CONFIG = {
  ENABLED: true,

  // Hard-block hours (UTC) — consistently worst across both training + v2 data.
  // 2026-06-30 refresh (382 live TREND+MOMENTUM trades): the entire 0-7 UTC overnight
  // window (Asian/pre-London low liquidity) is net-negative and — crucially — held
  // out-of-sample in BOTH halves of history (1st half -$0.54/trade, 2nd half -$0.31).
  // Backtest: blocking 0-7 UTC lifts net +$96->+$154 and MORE THAN DOUBLES per-trade
  // expectancy (+$0.25 -> +$0.56). It also subsumes the apparent "Saturday is bad"
  // effect (Saturday looked bad only because of its overnight hours). 13 & 20 UTC kept
  // from the original training-data blocks (13: 44% WR; 20: 20% WR live).
  BLOCKED_HOURS: [0, 1, 2, 3, 4, 5, 6, 7, 13, 20] as readonly number[],

  // Hard-block days (0=Sun, 1=Mon, ..., 5=Fri, 6=Sat)
  // Friday: 40.5% WR, -$938/trade training (worst day)
  // Monday: 49.0% WR, -$348/trade — borderline. NOT blocked (only 1 day blocked to keep
  //   gate lightweight; Friday alone trims ~$10M/year out of training PnL).
  BLOCKED_DAYS: [5] as readonly number[],

  // Boosted hours — lower entry score threshold by BOOST_AMOUNT
  // 12 UTC: 66.9% WR, +$783/trade training | +$0.71 avg v2 (BEST)
  // 14 UTC: 52.8% WR, +$524/trade training | +$0.53 avg v2
  // 17 UTC: 75% WR (small v2), +avg in training mid-tier — boosting based on v2 evidence
  // 21 UTC: 55.2% WR, +$1378/trade training (highest training avg PnL)
  BOOSTED_HOURS: [12, 14, 17, 21] as readonly number[],
  BOOST_AMOUNT: 5, // points to subtract from entry-score threshold (60 -> 55)
  // 2026-10-08: with MIN_CONFIDENCE=0.65, composite must be ≥65 anyway — scoreBoost
  // is a dead letter for TREND until confidence also respects the boost (not promoted;
  // conf loosen failed earlier PF / 60/60 n). See docs/reviews/2026-10-08-score-conf-coherence.md.
};

export interface TimeGateResult {
  allow: boolean;
  reason: string;
  scoreBoost: number; // amount to subtract from threshold (positive = easier to pass)
  hour: number;
  dayOfWeek: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function checkTimeGate(timestampMs?: number): TimeGateResult {
  const date = timestampMs != null ? new Date(timestampMs) : new Date();
  const hour = date.getUTCHours();
  const dow = date.getUTCDay();

  if (!TIME_GATE_CONFIG.ENABLED) {
    return { allow: true, reason: 'gate disabled', scoreBoost: 0, hour, dayOfWeek: dow };
  }

  if (TIME_GATE_CONFIG.BLOCKED_DAYS.includes(dow)) {
    return {
      allow: false,
      reason: `blocked day ${DAY_NAMES[dow]}`,
      scoreBoost: 0,
      hour,
      dayOfWeek: dow,
    };
  }

  if (TIME_GATE_CONFIG.BLOCKED_HOURS.includes(hour)) {
    return {
      allow: false,
      reason: `blocked hour ${hour}h UTC`,
      scoreBoost: 0,
      hour,
      dayOfWeek: dow,
    };
  }

  if (TIME_GATE_CONFIG.BOOSTED_HOURS.includes(hour)) {
    return {
      allow: true,
      reason: `boosted hour ${hour}h UTC`,
      scoreBoost: TIME_GATE_CONFIG.BOOST_AMOUNT,
      hour,
      dayOfWeek: dow,
    };
  }

  return { allow: true, reason: 'neutral', scoreBoost: 0, hour, dayOfWeek: dow };
}
