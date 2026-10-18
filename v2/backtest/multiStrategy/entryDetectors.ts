import type { Candle, SignalSnapshot } from '../../pipeline/types.ts';
import type { RegimeResult } from '../../indicators/indicators.ts';
import type { StrategyConfig, EntrySignal } from './types.ts';
import { V2_CONFIG } from '../../engine/config.ts';
import { evaluateSignals } from '../../pipeline/signalGenerator.ts';
import { applyLongTrendScoreAdjustments } from '../../pipeline/trendScoreAdjustments.ts';
import { checkTimeGate } from '../../pipeline/timeGate.ts';

const NO_ENTRY: EntrySignal = {
  shouldEnter: false, confidence: 0, entryPrice: 0,
  stopLoss: 0, takeProfit: 0, reason: '', metadata: {},
};

function atrDollar(signals: SignalSnapshot): number {
  const atrPct = signals.atr_percent as number;
  const price = signals.close_price as number;
  return atrPct > 0 && price > 0 ? price * atrPct / 100 : 0;
}

// --- Helper: standard deviation ---
function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// --- Helper: max/min over candle slice ---
function highOf(candles: Candle[]): number {
  let m = -Infinity;
  for (const c of candles) if (c.high > m) m = c.high;
  return m;
}
function lowOf(candles: Candle[]): number {
  let m = Infinity;
  for (const c of candles) if (c.low < m) m = c.low;
  return m;
}

// --- Helper: compute MACD histogram series for last N bars ---
// Recomputed locally so we can do z-score-based spike detection on a real series.
function macdHistSeries(candles: Candle[], n: number): number[] {
  if (candles.length < 35 + n) return [];

  const closes = candles.map(c => c.close);
  const ema = (period: number, src: number[]): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = src[0];
    for (let i = 0; i < src.length; i++) {
      prev = i === 0 ? src[i] : src[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  };

  const ema12 = ema(12, closes);
  const ema26 = ema(26, closes);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(9, macd);
  const hist = macd.map((v, i) => v - signal[i]);
  return hist.slice(-n);
}

// --- Helper: compute RSI for the candle slice ending at the given window ---
function rsiOf(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  const slice = candles.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i].close - slice[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function detectEntry(
  strategy: StrategyConfig,
  candles: Candle[],
  signals: SignalSnapshot,
  regime: RegimeResult,
): EntrySignal {
  if (!strategy.allowedRegimes.includes(regime.regime)) return NO_ENTRY;

  // TimeGate overlay (2026-05-06): blocks signals during data-discovered worst
  // hours/days regardless of which strategy is asking. The backtest passes the
  // current candle's time; in live, it falls back to wall-clock.
  const lastCandleTime = candles[candles.length - 1]?.time;
  const tg = checkTimeGate(lastCandleTime);
  if (!tg.allow) return NO_ENTRY;

  // Note: scoreBoost is consumed inside detectTrend (composite-score logic);
  // other strategies don't have a composite score so the boost only widens
  // the time-window, not their entry threshold.

  switch (strategy.name) {
    case 'TREND': return detectTrend(strategy, candles, signals, regime);
    case 'BREAKOUT': return detectBreakout(strategy, candles, signals, regime);
    case 'MEAN_REVERSION': return detectMeanReversion(strategy, candles, signals, regime);
    case 'MOMENTUM': return detectMomentum(strategy, candles, signals, regime);
    case 'SCALP': return detectScalp(strategy, candles, signals, regime);
    default: return NO_ENTRY;
  }
}

// ============================================================
// TREND — unchanged from original
// ============================================================
function detectTrend(
  config: StrategyConfig,
  candles: Candle[],
  signals: SignalSnapshot,
  regime: RegimeResult,
): EntrySignal {
  const evals = evaluateSignals(signals as Record<string, number | boolean | string>);
  const totalWeight = evals.reduce((s, e) => s + e.weight, 0);
  const baseScore = totalWeight > 0
    ? evals.reduce((s, e) => s + e.score * e.weight, 0) / totalWeight
    : 0;
  // Shared with live generateSignals / backtestEngine (UP +2 not +5; TC/maturity included).
  const { compositeScore: score, confidence } = applyLongTrendScoreAdjustments(
    baseScore,
    signals,
    regime,
  );

  // TimeGate score boost — during proven-best hours, lower threshold by BOOST_AMOUNT
  const tg = checkTimeGate(candles[candles.length - 1]?.time);
  const adjustedThreshold = config.entryParams.minCompositeScore - tg.scoreBoost;
  if (score < adjustedThreshold) return NO_ENTRY;
  // Live generateSignals also requires MIN_CONFIDENCE (0.65 → effective score≥65).
  // Without this, multiStrategy TREND admitted 60–64 (and boosted 55–64) that paper rejects.
  if (confidence < V2_CONFIG.MIN_CONFIDENCE) return NO_ENTRY;

  const price = signals.close_price as number;
  const atr = atrDollar(signals);
  if (atr <= 0) return NO_ENTRY;

  return {
    shouldEnter: true,
    confidence,
    entryPrice: price,
    stopLoss: price - atr * config.exitParams.stopLossValue,
    takeProfit: price + atr * config.exitParams.takeProfitValue,
    reason: `TREND score=${score.toFixed(1)}`,
    metadata: { compositeScore: score },
  };
}

// ============================================================
// BREAKOUT v2 — REBUILT
//   * Confirmation bar: prior bar broke above N-bar high; current bar holds above
//   * Pre-breakout consolidation: short-term ATR < long-term ATR (vol contraction)
//   * Volume sustain: breakout AND current bar both elevated
//   * Stop: just below the breakout level (not arbitrary ATR)
//   * Target: measured-move (breakout-bar range × 2)
// ============================================================
function detectBreakout(
  config: StrategyConfig,
  candles: Candle[],
  signals: SignalSnapshot,
  _regime: RegimeResult,
): EntrySignal {
  const lookback = config.entryParams.lookbackBars ?? 20;
  if (candles.length < Math.max(lookback + 5, 50)) return NO_ENTRY;

  const price = signals.close_price as number;
  const atrPct = signals.atr_percent as number;
  const atr = atrDollar(signals);
  if (atr <= 0 || atrPct < (config.entryParams.minAtrPercent ?? 0.3)) return NO_ENTRY;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lookbackBars = candles.slice(-lookback - 2, -2); // window ending 2 bars ago
  const breakoutLevel = highOf(lookbackBars);

  // CONFIRMATION: prev bar broke out, current bar holds above breakout level
  if (prev.close <= breakoutLevel) return NO_ENTRY;
  if (last.close <= breakoutLevel) return NO_ENTRY; // failed retest

  // CONSOLIDATION: short-term ATR < 80% of longer-term ATR
  const last10 = candles.slice(-12, -2);
  const last30 = candles.slice(-32, -2);
  const tr10 = last10.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, last10.length);
  const tr30 = last30.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, last30.length);
  if (tr30 > 0 && tr10 / tr30 > 0.85) return NO_ENTRY;

  // VOLUME SUSTAIN: both breakout bar (prev) and current bar elevated
  const volWindow = candles.slice(-22, -2);
  const avgVol = volWindow.reduce((s, c) => s + c.volume, 0) / Math.max(1, volWindow.length);
  const volMult = config.entryParams.volumeMultiplier ?? 1.3;
  if (prev.volume < avgVol * volMult) return NO_ENTRY;
  if (last.volume < avgVol * 1.0) return NO_ENTRY;

  // STOP: just below the breakout level — tightest reasonable stop
  const stopLoss = Math.min(breakoutLevel - atr * 0.3, last.close - atr * 1.5);

  // TARGET: measured-move = breakout-bar range × 2
  const breakoutBarRange = prev.high - prev.low;
  const takeProfit = price + Math.max(breakoutBarRange * 2, atr * 2);

  // CONFIDENCE
  const breakoutStrength = (price - breakoutLevel) / atr;
  const contractionRatio = tr30 > 0 ? tr10 / tr30 : 1;
  const confidence = Math.min(0.9,
    0.45
    + Math.min(0.15, breakoutStrength * 0.10)
    + Math.min(0.15, (0.85 - contractionRatio) * 0.5)
    + Math.min(0.15, (prev.volume / avgVol - volMult) * 0.05),
  );

  return {
    shouldEnter: true,
    confidence: Math.max(0.4, confidence),
    entryPrice: price,
    stopLoss,
    takeProfit,
    reason: `BREAKOUT v2 lvl=${breakoutLevel.toFixed(2)}, vol=${(prev.volume / avgVol).toFixed(1)}x, contract=${(contractionRatio * 100).toFixed(0)}%`,
    metadata: { breakoutLevel, breakoutStrength, contractionRatio, breakoutBarRange },
  };
}

// ============================================================
// MEAN_REVERSION v2 — REBUILT
//   * Reversal confirmation: 2-bar bullish reversal (higher low + higher close)
//   * RSI rising (oversold but turning up)
//   * Regime filter: ATR not expanding (range-bound, not crashing trend)
//   * Distance to mean: must have meaningful room to revert
//   * Stop: below 3-bar swing low
//   * Target: ema20 (mean target)
// ============================================================
function detectMeanReversion(
  config: StrategyConfig,
  candles: Candle[],
  signals: SignalSnapshot,
  _regime: RegimeResult,
): EntrySignal {
  if (candles.length < 30) return NO_ENTRY;

  const rsi = signals.rsi as number;
  const pctB = signals.bb_percent_b as number;
  const atrPct = signals.atr_percent as number;
  const price = signals.close_price as number;
  const atr = atrDollar(signals);
  const ema20 = signals.ema_12 as number; // ema_12 used as mean target (legacy field name)

  // Original oversold filters (moderately strict)
  const rsiThr = config.entryParams.rsiThreshold ?? 32;
  if (rsi > rsiThr) return NO_ENTRY;
  if (pctB > (config.entryParams.bbPercentBThreshold ?? 0.20)) return NO_ENTRY;
  if (atrPct > (config.entryParams.maxAtrPercent ?? 3.0)) return NO_ENTRY;
  if (atr <= 0) return NO_ENTRY;
  if (ema20 <= price) return NO_ENTRY;

  // REVERSAL CONFIRMATION (relaxed — bullish close OR rsi rising; not both)
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const bullishClose = last.close > prev.close;

  // RSI rising check
  const prevRsi = rsiOf(candles.slice(0, -1));
  const rsiRising = rsi > prevRsi;

  // Need at least one reversal signal (bullish close OR rsi turning up)
  if (!bullishClose && !rsiRising) return NO_ENTRY;

  // REGIME: ATR not violently expanding (we want range-bound, not crash-mode)
  const last10 = candles.slice(-11, -1);
  const last20 = candles.slice(-21, -1);
  const tr10 = last10.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, last10.length);
  const tr20 = last20.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, last20.length);
  if (tr20 > 0 && tr10 / tr20 > 1.50) return NO_ENTRY;

  // DISTANCE TO MEAN: ensure target gives meaningful R:R
  const distanceToMean = (ema20 - price) / price;
  if (distanceToMean < 0.003) return NO_ENTRY; // 0.3% min room

  // STOP: below 3-bar swing low
  const swingLow = Math.min(last.low, prev.low, candles[candles.length - 3].low);
  const stopLoss = swingLow - atr * 0.2;
  if (stopLoss >= price) return NO_ENTRY;

  // CONFIDENCE
  const oversoldDepth = (rsiThr - rsi) / rsiThr;
  const rsiMomentum = Math.min(0.15, Math.max(0, (rsi - prevRsi) / 10));
  const roomFactor = Math.min(0.15, distanceToMean * 10);
  const reversalBonus = (bullishClose && rsiRising) ? 0.10 : 0.05;
  const confidence = Math.min(0.85,
    0.35 + Math.max(0, oversoldDepth) * 0.30 + rsiMomentum + roomFactor + reversalBonus,
  );

  return {
    shouldEnter: true,
    confidence: Math.max(0.4, confidence),
    entryPrice: price,
    stopLoss,
    takeProfit: ema20,
    reason: `MR v2 RSI=${rsi.toFixed(0)}(prev=${prevRsi.toFixed(0)}), BB=${pctB.toFixed(2)}, room=${(distanceToMean * 100).toFixed(1)}%, bullish=${bullishClose}, rising=${rsiRising}`,
    metadata: { meanTarget: ema20, rsiAtEntry: rsi, rsiPrev: prevRsi, swingLow, distanceToMean },
  };
}

// ============================================================
// MOMENTUM v2 — REBUILT
//   * Real spike: macdHist z-score > N (vs 20-bar stdev) — not abs vs price-changes
//   * Higher highs: 3+ of last 5 closes higher than previous
//   * Real volume spike: ≥1.3× 20-bar avg
//   * RSI 50-70 (momentum but not exhausted)
//   * Stop: below 3-bar swing low
//   * Trail: percent_giveback (set in registry)
// ============================================================
function detectMomentum(
  config: StrategyConfig,
  candles: Candle[],
  signals: SignalSnapshot,
  _regime: RegimeResult,
): EntrySignal {
  if (candles.length < 50) return NO_ENTRY;

  const rsi = signals.rsi as number;
  const macdHist = signals.macd_histogram as number;
  const volRatio = signals.volume_ratio as number;
  const price = signals.close_price as number;
  const atr = atrDollar(signals);
  if (atr <= 0 || macdHist <= 0) return NO_ENTRY;

  // RSI bracket
  const rsiMin = config.entryParams.rsiMin ?? 50;
  const rsiMax = config.entryParams.rsiMax ?? 70;
  if (rsi < rsiMin || rsi > rsiMax) return NO_ENTRY;

  // VOLUME (real check)
  if (volRatio < (config.entryParams.volumeMultiplier ?? 1.3)) return NO_ENTRY;

  // PROPER SPIKE DETECTION: z-score against 20-bar histogram stdev
  const histSeries = macdHistSeries(candles, 21);
  if (histSeries.length < 21) return NO_ENTRY;
  const recentHist = histSeries.slice(0, 20);
  const histStdev = stdev(recentHist);
  if (histStdev <= 0) return NO_ENTRY;
  const histMean = recentHist.reduce((s, x) => s + x, 0) / recentHist.length;
  const zScore = (macdHist - histMean) / histStdev;
  const spikeThreshold = config.entryParams.histogramSpikeMultiplier ?? 1.5;
  if (zScore < spikeThreshold) return NO_ENTRY;

  // HIGHER HIGHS: 3+ of last 5 closes higher than previous
  const last6 = candles.slice(-6);
  let upBars = 0;
  for (let i = 1; i < last6.length; i++) {
    if (last6[i].close > last6[i - 1].close) upBars++;
  }
  if (upBars < 3) return NO_ENTRY;

  // CURRENT BAR HIGH > prior 3 bars' highs
  const last = candles[candles.length - 1];
  const last3prior = candles.slice(-4, -1);
  if (last.high <= highOf(last3prior)) return NO_ENTRY;

  // STOP: below 3-bar swing low
  const swingLow = lowOf(candles.slice(-4));
  const stopLoss = Math.min(swingLow - atr * 0.2, price - atr * 1.5);
  if (stopLoss >= price) return NO_ENTRY;

  // CONFIDENCE
  const spikeBonus = Math.min(0.20, (zScore - spikeThreshold) * 0.05);
  const upBonus = Math.min(0.15, (upBars - 3) * 0.05);
  const volBonus = Math.min(0.15, (volRatio - 1.3) * 0.10);
  const confidence = Math.min(0.90, 0.45 + spikeBonus + upBonus + volBonus);

  return {
    shouldEnter: true,
    confidence: Math.max(0.4, confidence),
    entryPrice: price,
    stopLoss,
    takeProfit: 0,
    reason: `MOM v2 z=${zScore.toFixed(1)}, RSI=${rsi.toFixed(0)}, up=${upBars}/5, vol=${volRatio.toFixed(1)}x`,
    metadata: { peakHistogram: macdHist, zScore, upBars, swingLow },
  };
}

// ============================================================
// SCALP — unchanged
// ============================================================
function detectScalp(
  config: StrategyConfig,
  _candles: Candle[],
  signals: SignalSnapshot,
  _regime: RegimeResult,
): EntrySignal {
  const rsi = signals.rsi as number;
  const volRatio = signals.volume_ratio as number;
  const price = signals.close_price as number;
  const atr = atrDollar(signals);
  if (atr <= 0) return NO_ENTRY;
  const rsiMin = config.entryParams.rsiPullbackMin ?? 35;
  const rsiMax = config.entryParams.rsiPullbackMax ?? 50;
  if (rsi < rsiMin || rsi > rsiMax) return NO_ENTRY;
  if (volRatio < (config.entryParams.minVolumeRatio ?? 0.8)) return NO_ENTRY;
  return {
    shouldEnter: true,
    confidence: 0.55,
    entryPrice: price,
    stopLoss: price - atr * config.exitParams.stopLossValue,
    takeProfit: price + atr * config.exitParams.takeProfitValue,
    reason: `SCALP RSI=${rsi.toFixed(0)}`,
    metadata: {},
  };
}
