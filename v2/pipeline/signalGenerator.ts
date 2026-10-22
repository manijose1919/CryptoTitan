// ============================================
// Phoenix V2 Signal Generator
// TREND strategy only, individually scored signals
// ============================================

import type { Candle, ScanResult, SignalResult } from './types.ts';
import { V2_CONFIG } from '../engine/config.ts';
import { checkTimeGate } from './timeGate.ts';
import { applyLongTrendScoreAdjustments } from './trendScoreAdjustments.ts';
import { computeSignals } from '../indicators/indicators.ts';
import { getSignalScores } from '../attribution/attributionStore.ts';

// --- Internal Types ---

interface SignalEval {
  name: string;
  score: number;   // 0-100
  active: boolean;
  weight: number;
}

// --- Adaptive Weight Map ---
// Maps signal eval names to scorecard signal names for weight adaptation
const EVAL_TO_SCORECARD: Record<string, string> = {
  rsi_momentum: 'rsi',
  macd_cross: 'macd_cross',
  trend_strength: 'trend_strength',
  volume_spike: 'volume_ratio',
  bb_lower_touch: 'bb_percent_b',
  tc_momentum: 'tc_value',
  sr_position: 'sr_channel_position',
  td_consensus: 'td_score',
};

// Cache scorecard verdicts for 5 minutes to avoid hammering SQLite
let _cachedVerdicts: Map<string, string> | null = null;
let _verdictCacheTime = 0;
const VERDICT_CACHE_TTL = 5 * 60 * 1000;

/** Research scripts can force base weights so baselines are not DATA_DIR-scorecard dependent. */
export type SignalWeightMode = 'adaptive' | 'static';
let _signalWeightMode: SignalWeightMode =
  process.env.V2_SIGNAL_WEIGHT_MODE === 'static' ? 'static' : 'adaptive';

export function setSignalWeightMode(mode: SignalWeightMode): void {
  _signalWeightMode = mode;
  _cachedVerdicts = null;
}

export function getSignalWeightMode(): SignalWeightMode {
  return _signalWeightMode;
}

function getScorecardVerdicts(): Map<string, string> {
  const now = Date.now();
  if (_cachedVerdicts && now - _verdictCacheTime < VERDICT_CACHE_TTL) {
    return _cachedVerdicts;
  }
  try {
    const scores = getSignalScores();
    _cachedVerdicts = new Map(scores.map((s) => [s.signalName, '']));
    for (const s of scores) {
      let verdict: string;
      if (s.totalTrades < V2_CONFIG.MIN_TRADES_FOR_SCORING) verdict = 'inconclusive';
      else if (s.edge > 0.003 && s.winRate > 0.55) verdict = 'proven';
      else if (s.edge < -0.002) verdict = 'negative';
      else verdict = 'inconclusive';
      _cachedVerdicts.set(s.signalName, verdict);
    }
  } catch (err) {
    console.warn('[SignalGenerator] Scorecard verdicts failed — using default weights:', (err as Error).message);
    _cachedVerdicts = new Map();
  }
  _verdictCacheTime = now;
  return _cachedVerdicts;
}

/**
 * Adjust signal weight based on scorecard verdict.
 * Proven → 1.5x weight, Negative → 0x (full prune), Inconclusive → 1.0x
 *
 * 2026-05-06: Negative multiplier was 0.5x (soft prune). With 133 trades of
 * data per signal we have enough confidence to hard-prune: signals showing
 * edge < -0.002 across MIN_TRADES_FOR_SCORING+ trades are excluded entirely.
 * Self-adapting — if a signal later turns positive in fresh data, it revives.
 *
 * Currently affected (verdict='negative' as of this change):
 *   - bb_percent_b → bb_lower_touch (base 40 → 0)
 *   - trend_strength → trend_strength eval (base 25 → 0)
 * Others (atr_percent, price_vs_ema50) are tracked but not in EVAL_TO_SCORECARD,
 * so this change doesn't reach them. They were already unused in the composite.
 */
function adaptWeight(evalName: string, baseWeight: number): number {
  if (_signalWeightMode === 'static') return baseWeight;
  const scorecardName = EVAL_TO_SCORECARD[evalName];
  if (!scorecardName) return baseWeight;
  const verdicts = getScorecardVerdicts();
  const verdict = verdicts.get(scorecardName);
  if (verdict === 'proven') return Math.round(baseWeight * 1.5);
  if (verdict === 'negative') return 0;
  return baseWeight;
}

/** Exported for unit tests — mirrors adaptWeight without needing a live scorecard. */
export function resolveSignalWeight(
  evalName: string,
  baseWeight: number,
  verdicts: Map<string, string>,
  mode: SignalWeightMode = 'adaptive',
): number {
  if (mode === 'static') return baseWeight;
  const scorecardName = EVAL_TO_SCORECARD[evalName];
  if (!scorecardName) return baseWeight;
  const verdict = verdicts.get(scorecardName);
  if (verdict === 'proven') return Math.round(baseWeight * 1.5);
  if (verdict === 'negative') return 0;
  return baseWeight;
}

// --- Signal Evaluation ---

/**
 * Evaluate 5 TREND signals independently. Each gets a score (0-100),
 * active flag, and weight for weighted averaging.
 * Weights are adapted based on signal scorecard verdicts.
 */
export function evaluateSignals(signals: Record<string, number | boolean | string>): SignalEval[] {
  const rsiVal = signals.rsi as number;
  const macdCross = signals.macd_cross as boolean;
  const macdHist = signals.macd_histogram as number;
  const prevMacdHist = signals.prev_macd_histogram as number ?? macdHist;
  const trendStr = signals.trend_strength as number;
  const volRatio = signals.volume_ratio as number;
  const pctB = signals.bb_percent_b as number;

  const evals: SignalEval[] = [];

  // 1. RSI momentum (weight 15)
  // TREND-following: RSI 45-65 is the sweet spot (healthy uptrend momentum)
  // Not mean-reversion — we don't need oversold, we need momentum
  let rsiScore: number;
  if (rsiVal < 30) rsiScore = 50;        // oversold — could be reversal but risky for trend entry
  else if (rsiVal < 45) rsiScore = 65;   // pullback zone — good for trend re-entry
  else if (rsiVal < 55) rsiScore = 80;   // ideal trend momentum
  else if (rsiVal < 65) rsiScore = 75;   // strong momentum, still healthy
  else if (rsiVal < 75) rsiScore = 50;   // getting extended
  else rsiScore = 15;                     // overbought — avoid
  evals.push({ name: 'rsi_momentum', score: rsiScore, active: rsiVal > 40 && rsiVal < 70, weight: adaptWeight('rsi_momentum', 15) });

  // 2. MACD cross (base weight 40, adapted by scorecard)
  // 2026-05-06 Config A: 20 → 40. Backtest scorecard consistently flagged macd_cross
  // as ✓ PROVEN (62.5% WR, +0.72% edge) when other PROVEN signals were also active.
  // Bumping weight to 40 boosted PF from 1.43 → 1.91 on AKT+ZEC+COMP 90d.
  // Fresh cross is best, but sustained positive histogram also valuable in trends.
  let macdScore: number;
  if (macdCross) macdScore = 95;                    // fresh bullish cross
  else if (macdHist > 0 && macdHist > prevMacdHist) macdScore = 80;  // rising histogram — accelerating
  else if (macdHist > 0) macdScore = 65;            // positive but decelerating
  else macdScore = 20;
  evals.push({ name: 'macd_cross', score: macdScore, active: macdCross || macdHist > 0, weight: adaptWeight('macd_cross', 40) });

  // 3. Trend strength (base weight 25, adapted by scorecard)
  // This is the most important signal for a TREND strategy — weight it highest
  let trendScore: number;
  if (trendStr > 2) trendScore = 90;
  else if (trendStr > 1) trendScore = 80;
  else if (trendStr > 0.5) trendScore = 70;
  else if (trendStr > 0) trendScore = 50;
  else trendScore = 10;
  evals.push({ name: 'trend_strength', score: trendScore, active: trendStr > 0.3, weight: adaptWeight('trend_strength', 25) });

  // 4. Volume confirmation (base weight 10, adapted by scorecard)
  // Volume confirms moves but shouldn't gate entries — reduced weight
  let volScore: number;
  if (volRatio > 2) volScore = 90;
  else if (volRatio > 1.5) volScore = 80;
  else if (volRatio > 1) volScore = 65;
  else if (volRatio > 0.7) volScore = 50;   // slightly below avg is ok in steady trends
  else volScore = 30;
  evals.push({ name: 'volume_spike', score: volScore, active: volRatio > 0.8, weight: adaptWeight('volume_spike', 10) });

  // 5. Bollinger position (base weight 10, adapted by scorecard)
  // TREND-following: price in upper half of bands is bullish, not bearish
  // Only avoid extremes (>0.95 = overextended)
  let bbScore: number;
  if (pctB < 0.2) bbScore = 55;        // near lower band — potential trend entry on pullback
  else if (pctB < 0.4) bbScore = 65;   // lower half — good pullback entry
  else if (pctB < 0.6) bbScore = 70;   // mid-band — neutral-positive
  else if (pctB < 0.8) bbScore = 65;   // upper half — trending, still ok
  else if (pctB < 0.95) bbScore = 40;  // near upper — getting stretched
  else bbScore = 15;                    // above upper band — overextended
  // 2026-05-06 Config A: weight 10 → 40. bb_percent_b shows ✓ PROVEN (66.7% WR, +2.50% edge)
  // consistently across all backtest runs — only signal that maintained PROVEN status under
  // tuned config. Boosting from 10 to 40 (matching macd_cross) lifts PF further.
  evals.push({ name: 'bb_lower_touch', score: bbScore, active: pctB < 0.85, weight: adaptWeight('bb_lower_touch', 40) });

  // ── TC (Trend Composite) Signals ──────────────────

  // 6. TC momentum (base weight 20) — core signal from PineScript daytrading system
  // TC < 20 = strong buy zone, TC > 80 = sell zone, inverted for score
  const tcVal = signals.tc_value as number ?? 50;
  const tcConsensus = signals.tc_consensus as number ?? 50;
  let tcScore: number;
  if (tcVal < 10) tcScore = 95;        // Deep buy zone — strongest signal
  else if (tcVal < 20) tcScore = 85;   // Buy zone
  else if (tcVal < 35) tcScore = 70;   // Leaning bullish
  else if (tcVal < 50) tcScore = 55;   // Neutral-bullish
  else if (tcVal < 65) tcScore = 40;   // Neutral
  else if (tcVal < 80) tcScore = 25;   // Leaning bearish
  else tcScore = 10;                    // Sell zone — avoid
  // Boost if multi-timeframe consensus agrees
  if (tcConsensus > 70 && tcScore > 50) tcScore = Math.min(100, tcScore + 10);
  evals.push({ name: 'tc_momentum', score: tcScore, active: tcVal < 40, weight: adaptWeight('tc_momentum', 20) });

  // 7. S/R channel position (base weight 10) — buy near support, avoid near resistance
  // In trends, mid-channel is fine — only heavily penalize entries right at resistance
  const srPos = signals.sr_channel_position as number ?? 0.5;
  let srScore: number;
  if (srPos < 0.15) srScore = 85;      // Right at support — excellent
  else if (srPos < 0.30) srScore = 75; // Near support
  else if (srPos < 0.50) srScore = 65; // Lower half of channel — good
  else if (srPos < 0.70) srScore = 55; // Upper half — acceptable in uptrend
  else if (srPos < 0.85) srScore = 35; // Near resistance — caution
  else srScore = 15;                    // At resistance — worst entry
  evals.push({ name: 'sr_position', score: srScore, active: srPos < 0.70, weight: adaptWeight('sr_position', 10) });

  // 8. Trend Dashboard consensus (base weight 15) — 6-indicator bull/bear vote
  // Bumped weight — strong consensus is a reliable trend confirmation
  const tdScore = signals.td_score as number ?? 50;
  let dashScore: number;
  if (tdScore >= 83) dashScore = 90;    // 5-6 bullish indicators
  else if (tdScore >= 67) dashScore = 80; // 4 bullish — strong
  else if (tdScore >= 50) dashScore = 60; // 3 bullish (neutral-bullish)
  else if (tdScore >= 33) dashScore = 35; // 2 bullish
  else dashScore = 15;                    // 0-1 bullish — bearish
  evals.push({ name: 'td_consensus', score: dashScore, active: tdScore >= 50, weight: adaptWeight('td_consensus', 15) });

  return evals;
}

// --- Signal Generation ---

/**
 * For each passed scan result, compute indicators, evaluate signals,
 * and produce a composite score. PASS if >= MIN_COMPOSITE_SCORE.
 * Results sorted by compositeScore descending.
 */
export function generateSignals(
  scanResults: ScanResult[],
  tickerCandles: Map<string, Candle[]>,
): SignalResult[] {
  const results: SignalResult[] = [];

  for (const scan of scanResults) {
    if (!scan.passed) continue;

    const candles = tickerCandles.get(scan.ticker);
    if (!candles || candles.length < V2_CONFIG.MIN_CANDLES) continue;

    const { signals, regime } = computeSignals(candles);
    const evals = evaluateSignals(signals);

    // Weighted average + shared live/backtest post-adjustments (regime/MACD/SR/BB/TC/maturity)
    const totalWeight = evals.reduce((sum, e) => sum + e.weight, 0);
    const baseScore = totalWeight > 0
      ? evals.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight
      : 0;
    const adjusted = applyLongTrendScoreAdjustments(baseScore, signals, regime);
    const compositeScore = adjusted.compositeScore;
    const confidence = adjusted.confidence;
    const tcVeto = adjusted.tcVeto;
    const pctB = signals.bb_percent_b as number;
    const tcVal = signals.tc_value as number ?? 50;
    const maturityNote =
      regime.trendMaturity > V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD
        ? `, maturity=${regime.trendMaturity}`
        : '';

    // TimeGate overlay (2026-05-06): hour-of-day + day-of-week filter discovered
    // from data analysis on 132K training trades + 137 v2 production trades.
    // Blocks worst hours (0, 4, 13, 20 UTC) and Fridays; boosts entries during
    // proven-best hours (12, 14, 17, 21 UTC) by lowering score threshold.
    // For backtests, candle's last-bar time is passed in via tickerCandles;
    // for live, defaults to Date.now() for current wall-clock.
    const lastCandleTime = candles[candles.length - 1]?.time;
    const tg = checkTimeGate(lastCandleTime);
    const adjustedThreshold = V2_CONFIG.MIN_COMPOSITE_SCORE - tg.scoreBoost;

    const volRatio = signals.volume_ratio as number;
    const minVol = (V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO?: number }).MIN_SIGNAL_VOLUME_RATIO;
    const volOk = minVol == null || (Number.isFinite(volRatio) && volRatio >= minVol);

    const passed = tg.allow
                && compositeScore >= adjustedThreshold
                && confidence >= V2_CONFIG.MIN_CONFIDENCE
                && volOk;

    const activeSignals = evals.filter((e) => e.active).map((e) => e.name);
    const bbNote = pctB > 0.95 ? `, BB%B=${pctB.toFixed(2)}(penalty)` : '';
    const tcNote = tcVeto ? `, TC=${tcVal.toFixed(1)}(sell-zone)` : '';
    const confNote = confidence < V2_CONFIG.MIN_CONFIDENCE ? `, conf=${confidence.toFixed(2)}<${V2_CONFIG.MIN_CONFIDENCE}` : '';
    const volNote = !volOk ? `, vol=${Number(volRatio).toFixed(2)}<${minVol}` : '';
    const tgNote = !tg.allow ? `, TimeGate=${tg.reason}` : (tg.scoreBoost > 0 ? `, TimeGate=${tg.reason}(thresh ${adjustedThreshold})` : '');
    const reason = !tg.allow
      ? `REJECT: TimeGate ${tg.reason} (score=${compositeScore.toFixed(1)} ignored)`
      : !volOk
        ? `REJECT: volume_ratio ${Number(volRatio).toFixed(3)} < min ${minVol} (score=${compositeScore.toFixed(1)})`
      : passed
        ? `PASS: score=${compositeScore.toFixed(1)}, active=[${activeSignals.join(', ')}]${bbNote}${tcNote}${maturityNote}${tgNote}`
        : `REJECT: score=${compositeScore.toFixed(1)} < min ${adjustedThreshold}${bbNote}${tcNote}${confNote}${volNote}${maturityNote}${tgNote}`;

    results.push({
      ticker: scan.ticker,
      passed,
      compositeScore,
      confidence,
      signals,
      regime: regime.regime,
      reason,
    });
  }

  // Sort descending by composite score
  results.sort((a, b) => b.compositeScore - a.compositeScore);

  return results;
}

/**
 * Filter signal results to only those that passed.
 */
export function getPassedSignals(results: SignalResult[]): SignalResult[] {
  return results.filter((r) => r.passed);
}

/**
 * Generate SHORT signals — inverted scoring for bearish entries.
 * Only called when SHORTS_ENABLED and tickers pass scan with side='short'.
 */
export function generateShortSignals(
  scanResults: ScanResult[],
  tickerCandles: Map<string, Candle[]>,
): SignalResult[] {
  const results: SignalResult[] = [];

  for (const scan of scanResults) {
    if (!scan.passed) continue;
    const candles = tickerCandles.get(scan.ticker);
    if (!candles || candles.length < V2_CONFIG.MIN_CANDLES) continue;

    const { signals, regime } = computeSignals(candles);

    // Short-specific signal scoring (inverted from long)
    const rsiVal = signals.rsi as number ?? 50;
    const macdHist = signals.macd_histogram as number ?? 0;
    const trendStr = signals.trend_strength as number ?? 0;
    const tcVal = signals.tc_value as number ?? 50;
    const pctB = signals.bb_percent_b as number ?? 0.5;

    // RSI: 30-55 is healthy downtrend without oversold bounce risk
    const rsiScore = rsiVal >= 30 && rsiVal <= 55 ? 80 + (50 - rsiVal) : (rsiVal < 30 ? 30 : 40);
    // MACD: negative histogram = bearish momentum
    const macdScore = macdHist < 0 ? Math.min(95, 60 + Math.abs(macdHist) * 500) : 30;
    // Trend: negative trend strength = strong downtrend
    const trendScore = trendStr < 0 ? Math.min(90, 50 + Math.abs(trendStr) * 2) : 30;
    // TC: >60 suggests selling pressure
    const tcScore = tcVal > 80 ? 90 : (tcVal > 60 ? 70 : 40);
    // BB: price in lower half confirms downtrend
    const bbScore = pctB < 0.3 ? 80 : (pctB < 0.5 ? 65 : 35);

    let compositeScore = (rsiScore * 0.25 + macdScore * 0.25 + trendScore * 0.20 + tcScore * 0.15 + bbScore * 0.15);

    // Regime bonus for shorts
    if (regime.regime === 'STRONG_DOWN') compositeScore += 8;
    else if (regime.regime === 'DOWN') compositeScore += 5;

    compositeScore = Math.min(100, compositeScore);

    // Trend maturity penalty (applies to shorts too — exhausted downtrend = risky short)
    if (regime.trendMaturity > V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD) {
      const excess = regime.trendMaturity - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
      const maxExcess = 100 - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
      compositeScore -= Math.round((excess / maxExcess) * V2_CONFIG.TREND_MATURITY_MAX_PENALTY);
    }

    const confidence = compositeScore / 100;

    const lastCandleTime = candles[candles.length - 1]?.time;
    const tg = checkTimeGate(lastCandleTime);
    const adjustedThreshold = V2_CONFIG.MIN_COMPOSITE_SCORE - tg.scoreBoost;

    const passed = tg.allow
                && compositeScore >= adjustedThreshold
                && confidence >= V2_CONFIG.MIN_CONFIDENCE;

    const reason = passed
      ? `SHORT PASS: score=${compositeScore.toFixed(1)}, RSI=${rsiVal.toFixed(0)}, MACD=${macdHist.toFixed(4)}`
      : `SHORT REJECT: score=${compositeScore.toFixed(1)} < ${adjustedThreshold}`;

    results.push({
      ticker: scan.ticker,
      passed,
      compositeScore,
      confidence,
      signals,
      regime: regime.regime,
      side: 'short',
      reason,
    });
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}
