// ============================================
// Phoenix V2 Backtest Engine
// Bar-by-bar replay through the V2 pipeline
// Uses real computeSignals + evaluateSignals,
// implements exit simulation on OHLC bars
// ============================================

import type { Candle } from '../pipeline/types.ts';
import { EXIT_REASON } from '../pipeline/types.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, STRATEGY_EXIT_CONFIGS } from '../engine/config.ts';
import type { StrategyExitConfig } from '../engine/config.ts';
import { adx, computeSignals } from '../indicators/indicators.ts';
import { evaluateSignals } from '../pipeline/signalGenerator.ts';
import { detectMomentumEntry } from '../pipeline/momentumSignal.ts';
import { checkTimeGate } from '../pipeline/timeGate.ts';
import { scanMarket } from '../pipeline/marketScanner.ts';
import { SIGNAL_ACTIVE_THRESHOLDS } from '../attribution/postTradeAnalyzer.ts';
import { applyPaperSlippage } from '../engine/tradeAccounting.ts';
import { getNextBarEntryPrice } from './backtestExecution.ts';
import type {
  BacktestConfig,
  BacktestTrade,
  BacktestResult,
  BacktestSummary,
  SignalScoreResult,
  RegimeBreakdown,
  TickerBreakdown,
} from './types.ts';
import { loadAllCandles } from './candleCache.ts';

// --- ID Generator ---

let _tradeCounter = 0;
function nextTradeId(ticker: string): string {
  _tradeCounter++;
  return `bt_${ticker}_${_tradeCounter}`;
}

// --- Exit Simulation (in-memory, uses OHLC bars) ---

interface ExitCheckResult {
  shouldExit: boolean;
  exitPrice: number;
  exitReason: typeof EXIT_REASON[keyof typeof EXIT_REASON] | null;
  newStop: number;
  trailingActivated: boolean;
}

/**
 * Paper `exitManager` reads STRATEGY_EXIT_CONFIGS (bar×tf timers + trail %).
 * Historically this backtest used V2_CONFIG wall-clock TIME_KILL_MS (6h) and a
 * desynced trail activate — so ablations disagreed with the paper soak.
 * Resolve TREND exit knobs for the backtest interval (default engine path).
 */
/**
 * Signal-bar quality gate for next-bar-open longs (research + optional backtest config).
 * Rejects chase entries (close near high) and/or chaotic wide-range bars.
 */
export function passesEntryBarQuality(
  signalBar: Candle,
  atr: number,
  filters: NonNullable<BacktestConfig['entryFilters']>,
  side: 'long' | 'short' = 'long',
): { ok: boolean; reason?: string } {
  const range = signalBar.high - signalBar.low;
  if (filters.maxSignalRangeAtrMult != null && atr > 0) {
    const rangeAtr = range / atr;
    if (rangeAtr > filters.maxSignalRangeAtrMult) {
      return { ok: false, reason: `signal range/ATR ${rangeAtr.toFixed(2)} > ${filters.maxSignalRangeAtrMult}` };
    }
  }
  if (filters.maxSignalCloseLocation != null && range > 0) {
    const closeLoc = (signalBar.close - signalBar.low) / range;
    if (side === 'long' && closeLoc > filters.maxSignalCloseLocation) {
      return { ok: false, reason: `chase closeLoc ${closeLoc.toFixed(2)} > ${filters.maxSignalCloseLocation}` };
    }
    if (side === 'short' && closeLoc < (1 - filters.maxSignalCloseLocation)) {
      return { ok: false, reason: `chase closeLoc ${closeLoc.toFixed(2)} < ${(1 - filters.maxSignalCloseLocation).toFixed(2)}` };
    }
  }
  return { ok: true };
}

/** Confirmation-bar gate (research). Signal on bar T; confirm on T+1; enter T+2 open. */
export function passesConfirmBar(
  signalBar: Candle,
  confirmBar: Candle,
  mode: 'bullish_close' | 'close_above_signal' | 'bullish_and_above',
  side: 'long' | 'short' = 'long',
): { ok: boolean; reason?: string } {
  const needBullish = mode === 'bullish_close' || mode === 'bullish_and_above';
  const needAbove = mode === 'close_above_signal' || mode === 'bullish_and_above';

  if (needBullish) {
    const bullish = confirmBar.close > confirmBar.open;
    const bearish = confirmBar.close < confirmBar.open;
    if (side === 'long' && !bullish) {
      return { ok: false, reason: 'confirm bar not bullish' };
    }
    if (side === 'short' && !bearish) {
      return { ok: false, reason: 'confirm bar not bearish' };
    }
  }
  if (needAbove) {
    if (side === 'long' && !(confirmBar.close > signalBar.close)) {
      return { ok: false, reason: 'confirm close ≤ signal close' };
    }
    if (side === 'short' && !(confirmBar.close < signalBar.close)) {
      return { ok: false, reason: 'confirm close ≥ signal close' };
    }
  }
  return { ok: true };
}

/**
 * Paper `strategyRunner` only evaluates MOMENTUM on scan-PASS + ADX.
 * Backtest must use the same conjunction (not ADX alone).
 */
export function isMomentumScanEligible(scanPassed: boolean, adxOk: boolean): boolean {
  return Boolean(scanPassed && adxOk);
}

/** Optional ATR%-band gate on the signal (research). */
export function passesSignalAtrBand(
  atrPercent: number,
  filters: NonNullable<BacktestConfig['entryFilters']>,
): { ok: boolean; reason?: string } {
  if (filters.minSignalAtrPercent != null && atrPercent < filters.minSignalAtrPercent) {
    return { ok: false, reason: `atr% ${atrPercent.toFixed(2)} < min ${filters.minSignalAtrPercent}` };
  }
  if (filters.maxSignalAtrPercent != null && atrPercent > filters.maxSignalAtrPercent) {
    return { ok: false, reason: `atr% ${atrPercent.toFixed(2)} > max ${filters.maxSignalAtrPercent}` };
  }
  return { ok: true };
}

/** True once the fill bar is reached (guards pre-entry exit marks). */
export function isPositionLiveOnBar(barIndex: number, entryBar: number): boolean {
  return barIndex >= entryBar;
}

export function resolvePaperTrendExitConfig(interval: string): StrategyExitConfig & {
  trailActivatePercentFloored: number;
  timeKillBarsResolved: number;
} {
  const exitCfg: StrategyExitConfig = STRATEGY_EXIT_CONFIGS.TREND;
  const timeKillBarsResolved = exitCfg.timeKillBarsByTf?.[interval] ?? exitCfg.timeKillBars;
  const trailActivatePercentFloored = Math.max(
    exitCfg.trailActivatePercent,
    V2_CONFIG.FEE_ROUND_TRIP_TAKER * V2_CONFIG.TRAIL_ACTIVATE_FEE_FLOOR_MULT,
  );
  return { ...exitCfg, trailActivatePercentFloored, timeKillBarsResolved };
}

/**
 * Simulate intra-bar price sequence to match live engine behavior.
 * Live checks exits every 60s; this simulates 4 price points per bar.
 * Ordering depends on config.barSequence (default 'pessimistic'):
 *   pessimistic: Open → adverse extreme → favorable extreme → Close
 *     (SL is tested before TP when both fall inside one bar, and trailing
 *      can't ratchet on the favorable extreme before the adverse is checked)
 *   optimistic (legacy, for comparison runs): Open → favorable → adverse → Close
 * At each step: update peak, check BE/trailing/stops — just like live.
 */
export function checkExitOnBar(
  trade: BacktestTrade,
  bar: Candle,
  barIndex: number,
  config: BacktestConfig,
): ExitCheckResult {
  const holdBars = barIndex - trade.entryBar;
  const isShort = trade.side === 'short';
  const exitCfg = resolvePaperTrendExitConfig(config.interval);
  const trailActivate = exitCfg.trailActivatePercentFloored;
  const trailGiveback = exitCfg.trailGivebackPercent;

  let currentStop = trade.currentStop;
  let trailingActivated = trade.trailingActivated;

  // Build intra-bar price sequence (see checkExitOnBar doc comment).
  // Pessimistic (default): adverse extreme before favorable extreme.
  // Optimistic (legacy): favorable extreme first — inflates results when TP and SL
  // both fall inside one bar; kept only for comparison runs.
  const optimistic = config.barSequence === 'optimistic';
  const priceSequence = isShort
    ? (optimistic
        ? [bar.open, bar.low, bar.high, bar.close]    // short: low (favorable) first
        : [bar.open, bar.high, bar.low, bar.close])   // short: high (adverse) first
    : (optimistic
        ? [bar.open, bar.high, bar.low, bar.close]    // long: high (favorable) first
        : [bar.open, bar.low, bar.high, bar.close]);  // long: low (adverse) first

  for (let seqIndex = 0; seqIndex < priceSequence.length; seqIndex++) {
    const price = priceSequence[seqIndex];
    // Update peak price (highest for longs, lowest for shorts)
    if (isShort) {
      if (price < trade.peakPrice) trade.peakPrice = price;
    } else {
      if (price > trade.peakPrice) trade.peakPrice = price;
    }

    // Check SL
    const slHit = isShort ? price >= currentStop : price <= currentStop;
    if (slHit) {
      const stopWasRaised = isShort ? currentStop < trade.stopLoss : currentStop > trade.stopLoss;
      // Gap-through fill: if the bar OPENED beyond the stop (first sequence price
      // already breaches), the fill happens at the open, not the stop price.
      // Intra-bar touches still fill at the stop price.
      const exitPrice = seqIndex === 0
        ? (isShort ? Math.max(currentStop, bar.open) : Math.min(currentStop, bar.open))
        : currentStop;
      return {
        shouldExit: true,
        exitPrice,
        exitReason: stopWasRaised ? EXIT_REASON.trailing : EXIT_REASON.stop_loss,
        newStop: currentStop,
        trailingActivated,
      };
    }

    // Check TP
    const tpHit = isShort ? price <= trade.takeProfit : price >= trade.takeProfit;
    if (tpHit) {
      return {
        shouldExit: true,
        exitPrice: trade.takeProfit,
        exitReason: EXIT_REASON.take_profit,
        newStop: currentStop,
        trailingActivated,
      };
    }

    // PnL at this price point
    const pnl = isShort
      ? (trade.entryPrice - price) / trade.entryPrice
      : (price - trade.entryPrice) / trade.entryPrice;

    // Break-even stop
    const beTrigger = trailActivate * 0.6;
    const atrForBE = (trade.atrPercent || 1.0) / 100;
    const beOffset = atrForBE * 0.5;
    if (pnl >= beTrigger) {
      const beStop = isShort
        ? trade.entryPrice * (1 - beOffset)
        : trade.entryPrice * (1 + beOffset);
      const beShouldUpdate = isShort ? beStop < currentStop : beStop > currentStop;
      if (beShouldUpdate) currentStop = beStop;
    }

    // Trailing stop — paper STRATEGY_EXIT_CONFIGS.TREND (+ fee floor)
    if (pnl >= trailActivate) {
      trailingActivated = true;

      let givebackFraction = trailGiveback;
      if (trade.atrPercent > 2.0) givebackFraction *= 1.3;
      else if (trade.atrPercent > 1.0) givebackFraction *= 1.1;
      else if (trade.atrPercent < 0.3) givebackFraction *= 0.7;

      const profitVsActivation = pnl / trailActivate;
      if (profitVsActivation < 1.5) givebackFraction *= 1.5;
      else if (profitVsActivation < 2.0) {
        const t = (profitVsActivation - 1.5) / 0.5;
        givebackFraction *= 1.5 - t * 0.5;
      }

      const tpPercent = Math.abs(trade.takeProfit - trade.entryPrice) / trade.entryPrice;
      const profitMultiple = tpPercent > 0 ? pnl / tpPercent : 1;
      if (profitMultiple >= 2.0) givebackFraction *= 0.6;
      else if (profitMultiple >= 1.5) givebackFraction *= 0.8;

      const peakGain = isShort
        ? trade.entryPrice - trade.peakPrice
        : trade.peakPrice - trade.entryPrice;
      const trailingStop = isShort
        ? trade.peakPrice + peakGain * givebackFraction
        : trade.peakPrice - peakGain * givebackFraction;

      const trailShouldUpdate = isShort ? trailingStop < currentStop : trailingStop > currentStop;
      if (trailShouldUpdate) currentStop = trailingStop;
    }
  }

  // Quick-kill (checked at bar end) — paper TREND quickKillBars / minGain / slMult
  const peakPnlPercent = isShort
    ? (trade.entryPrice - trade.peakPrice) / trade.entryPrice
    : (trade.peakPrice - trade.entryPrice) / trade.entryPrice;
  if (holdBars >= exitCfg.quickKillBars && peakPnlPercent < exitCfg.quickKillMinGain && trade.atrPercent > 0) {
    const qkMult = trade.atrPercent > 1.5 ? exitCfg.quickKillSlMult * 0.5
                 : trade.atrPercent > 1.0 ? exitCfg.quickKillSlMult * 0.75
                 : exitCfg.quickKillSlMult;
    const tighterStop = isShort
      ? trade.entryPrice + (trade.entryPrice * trade.atrPercent / 100) * qkMult
      : trade.entryPrice - (trade.entryPrice * trade.atrPercent / 100) * qkMult;
    // Mirror paper exitManager: never place quick-kill stop through the market.
    const qkOnValidSide = isShort ? tighterStop > bar.close : tighterStop < bar.close;
    const qkShouldUpdate = qkOnValidSide && (isShort ? tighterStop < currentStop : tighterStop > currentStop);
    if (qkShouldUpdate) currentStop = tighterStop;
  }

  // Time kill (bar×tf, matching paper exitManager) — not V2_CONFIG.TIME_KILL_MS wall clock
  const pnlAtClose = isShort
    ? (trade.entryPrice - bar.close) / trade.entryPrice
    : (bar.close - trade.entryPrice) / trade.entryPrice;
  if (holdBars >= exitCfg.timeKillBarsResolved && Math.abs(pnlAtClose) < exitCfg.timeKillMinMove) {
    return {
      shouldExit: true,
      exitPrice: bar.close,
      exitReason: EXIT_REASON.time_kill,
      newStop: currentStop,
      trailingActivated,
    };
  }

  return {
    shouldExit: false,
    exitPrice: bar.close,
    exitReason: null,
    newStop: currentStop,
    trailingActivated,
  };
}

// --- Per-Ticker Simulation ---

interface TickerState {
  cash: number;
  openTrades: BacktestTrade[];
  closedTrades: BacktestTrade[];
  dailyPnl: number;
  lastLossTime: number;
}

function simulateTicker(
  ticker: string,
  candles: Candle[],
  config: BacktestConfig,
): BacktestTrade[] {
  const state: TickerState = {
    cash: config.budgetPerTicker,
    openTrades: [],
    closedTrades: [],
    dailyPnl: 0,
    lastLossTime: 0,
  };
  let lastExitTime = 0; // Re-entry cooldown tracking

  // Walk bar-by-bar from MIN_CANDLES to end
  for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length; bar++) {
    const currentCandle = candles[bar];

    // Reset daily PnL at midnight boundaries
    if (bar > V2_CONFIG.MIN_CANDLES) {
      const prevDay = new Date(candles[bar - 1].time).getUTCDate();
      const currDay = new Date(currentCandle.time).getUTCDate();
      if (currDay !== prevDay) {
        state.dailyPnl = 0;
      }
    }

    // --- CHECK EXITS (before entries, like live engine) ---
    const stillOpen: BacktestTrade[] = [];

    for (const trade of state.openTrades) {
      // confirmMode (and next-bar) may push a trade before its entryBar.
      // Do not mark-to-exit on bars that precede the fill — that produced
      // holdBars=-1 stop-outs in the 2026-10-01 confirm-bar research.
      if (!isPositionLiveOnBar(bar, trade.entryBar)) {
        stillOpen.push(trade);
        continue;
      }

      const exitResult = checkExitOnBar(trade, currentCandle, bar, config);

      // Update trade state
      trade.currentStop = exitResult.newStop;
      trade.trailingActivated = exitResult.trailingActivated;

      if (exitResult.shouldExit) {
        // Exit price from the intra-bar simulation (stop price for SL/trailing, TP for take_profit)
        const exitPrice = applyPaperSlippage(
          exitResult.exitPrice,
          trade.side,
          'exit',
          config.slippagePerSide,
        );
        const pnlGross = trade.side === 'short'
          ? (trade.entryPrice - exitPrice) * trade.quantity
          : (exitPrice - trade.entryPrice) * trade.quantity;
        const feesPaid = trade.positionSizeUsd * config.feeRoundTrip;
        const pnlNet = pnlGross - feesPaid;
        const holdBars = bar - trade.entryBar;

        trade.exitBar = bar;
        trade.exitPrice = exitPrice;
        trade.exitTime = currentCandle.time;
        trade.exitReason = exitResult.exitReason;
        trade.pnlGross = pnlGross;
        trade.pnlNet = pnlNet;
        trade.feesPaid = feesPaid;
        trade.holdBars = holdBars;
        trade.holdDurationMs = holdBars * config.intervalMinutes * 60 * 1000;

        state.cash += trade.positionSizeUsd + pnlNet;
        state.dailyPnl += pnlNet;
        if (pnlNet < 0) state.lastLossTime = currentCandle.time;

        state.closedTrades.push(trade);
        lastExitTime = currentCandle.time;
      } else {
        stillOpen.push(trade);
      }
    }

    state.openTrades = stillOpen;

    // --- CHECK ENTRY ---
    const nextCandle = candles[bar + 1];
    if (!nextCandle) continue;
    if (state.openTrades.length >= config.maxOpenPositions) continue;

    // Re-entry cooldown
    if (lastExitTime > 0 && V2_CONFIG.REENTRY_COOLDOWN_MS > 0) {
      if (currentCandle.time - lastExitTime < V2_CONFIG.REENTRY_COOLDOWN_MS) continue;
    }

    // Circuit breaker cooldown
    if (state.lastLossTime > 0) {
      const timeSinceLoss = currentCandle.time - state.lastLossTime;
      if (timeSinceLoss < V2_CONFIG.CIRCUIT_BREAKER_COOLDOWN_MS) continue;
    }

    // Daily loss limit
    const dailyLossPercent = state.cash > 0 ? state.dailyPnl / config.budgetPerTicker : 0;
    if (dailyLossPercent < -V2_CONFIG.MAX_DAILY_LOSS_PERCENT) continue;

    // Build candle window for indicator computation
    const window = candles.slice(0, bar + 1);

    // Run market scanner (single ticker)
    const tickerCandles = new Map([[ticker, window]]);
    const scanResults = scanMarket(tickerCandles);
    const passed = scanResults.find((s) => s.ticker === ticker && s.passed);

    // --- TREND entry attempt ---
    let trendEntry = false;
    // Paper strategyRunner ADX gate (optional; set entryFilters.minAdx for parity)
    const adxOk =
      config.entryFilters?.minAdx == null
      || (window.length >= 30 && adx(window) >= config.entryFilters.minAdx);
    if (passed && adxOk) {
      const { signals, regime } = computeSignals(window);
      const evals = evaluateSignals(signals);
      const totalWeight = evals.reduce((sum, e) => sum + e.weight, 0);
      let compositeScore = totalWeight > 0
        ? evals.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight
        : 0;

      if (regime.regime === 'STRONG_UP') compositeScore += 8;
      else if (regime.regime === 'UP') compositeScore += 2;
      compositeScore = Math.min(compositeScore, 100);

      const pctB = signals.bb_percent_b as number;
      if (pctB > 0.80) compositeScore -= Math.round(6 + (pctB - 0.80) * 120);

      if (regime.trendMaturity > V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD) {
        const excess = regime.trendMaturity - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
        const maxExcess = 100 - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
        compositeScore -= Math.round((excess / maxExcess) * V2_CONFIG.TREND_MATURITY_MAX_PENALTY);
      }

      const tg = checkTimeGate(window[window.length - 1]?.time);
      const confidence = compositeScore / 100;
      const atrPercent = signals.atr_percent as number;
      // Paper riskGate/executor size SL/TP from STRATEGY_EXIT_CONFIGS.TREND
      const trendExit = STRATEGY_EXIT_CONFIGS.TREND;
      const tpPercent = atrPercent * trendExit.tpAtrMult / 100;
      const expectedReturn = tpPercent - config.feeRoundTrip;

      if (tg.allow
        && compositeScore >= V2_CONFIG.MIN_COMPOSITE_SCORE - tg.scoreBoost
        && confidence >= V2_CONFIG.MIN_CONFIDENCE
        && expectedReturn >= V2_CONFIG.MIN_EXPECTED_RETURN
      ) {
        const atrValue = signals.atr as number;
        let entryQualityOk = true;
        if (config.entryFilters) {
          const signalBar = window[window.length - 1]!;
          entryQualityOk =
            passesEntryBarQuality(signalBar, atrValue, config.entryFilters, 'long').ok
            && passesSignalAtrBand(atrPercent, config.entryFilters).ok;
        }
        if (entryQualityOk) {
          const confirmMode = config.entryFilters?.confirmMode;
          const signalBar = window[window.length - 1]!;
          let entrySignalIndex = bar; // getNextBarEntryPrice uses signalIndex+1 open
          let entryCandle = nextCandle;
          let confirmOk = true;
          if (confirmMode) {
            const confirmBar = candles[bar + 1];
            const entryBarCandle = candles[bar + 2];
            if (!confirmBar || !entryBarCandle) {
              confirmOk = false;
            } else {
              confirmOk = passesConfirmBar(signalBar, confirmBar, confirmMode, 'long').ok;
              entrySignalIndex = bar + 1;
              entryCandle = entryBarCandle;
            }
          }
          if (confirmOk) {
            const entryPrice = getNextBarEntryPrice(
              candles,
              entrySignalIndex,
              'long',
              config.slippagePerSide,
            );
            if (entryPrice != null) {
              const stopLoss = entryPrice - atrValue * trendExit.slAtrMult;
              const takeProfit = entryPrice + atrValue * trendExit.tpAtrMult;

              // Position sizing with risk-based cap (matches live riskGate)
              const maxPositionUsd = state.cash * V2_CONFIG.BASE_POSITION_PERCENT;
              let positionSizeUsd = maxPositionUsd * confidence;
              const stopDistPct = Math.abs(entryPrice - stopLoss) / entryPrice;
              if (stopDistPct > 0 && V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT > 0) {
                const maxRiskUsd = config.budgetPerTicker * V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT;
                const riskCapSize = maxRiskUsd / stopDistPct;
                if (positionSizeUsd > riskCapSize) positionSizeUsd = riskCapSize;
              }
              if (positionSizeUsd >= 10 && positionSizeUsd <= state.cash) {
                const quantity = entryPrice > 0 ? positionSizeUsd / entryPrice : 0;
                const entryBarIndex = entrySignalIndex + 1;

                state.cash -= positionSizeUsd;
                state.openTrades.push({
                  id: nextTradeId(ticker),
                  ticker, side: 'long', entryBar: entryBarIndex, entryPrice,
                  entryTime: entryCandle.time, entrySignals: signals,
                  entryRegime: regime.regime, entryConfidence: confidence, compositeScore,
                  exitBar: null, exitPrice: null, exitTime: null, exitReason: null,
                  quantity, positionSizeUsd, stopLoss, takeProfit,
                  currentStop: stopLoss, trailingActivated: false, peakPrice: entryPrice,
                  pnlGross: null, pnlNet: null, feesPaid: 0,
                  holdBars: 0, holdDurationMs: null, atrPercent,
                });
                trendEntry = true;
              }
            }
          }
        }
      }
    }

    // --- MOMENTUM fallback entry (paper strategyRunner parity) ---
    // Paper only evaluates MOMENTUM on scan-PASS + ADX≥TREND_MIN (strategyRunner).
    // Previously this path checked ADX alone and bypassed MAX_ATR / regime / volume
    // scan gates — inflating research OOS (e.g. DOT atr% 3.3 under MAX 2.5).
    // confirmMomentum+confirmMode → T+2 confirm parity with TREND (research).
    if (!trendEntry && MOMENTUM_CONFIG.ENABLED && isMomentumScanEligible(!!passed, adxOk)) {
      const momSignal = detectMomentumEntry(window, ticker);
      const momAtrPct = momSignal ? (momSignal.signals.atr_percent as number) : 0;
      const momAtrBandOk = !config.entryFilters
        || passesSignalAtrBand(momAtrPct, config.entryFilters).ok;
      if (
        momSignal
        && momSignal.confidence >= MOMENTUM_CONFIG.MIN_CONFIDENCE
        && momAtrBandOk
      ) {
        const confirmMode = config.entryFilters?.confirmMode;
        const useMomConfirm = !!(confirmMode && config.entryFilters?.confirmMomentum);
        const signalBar = window[window.length - 1]!;
        let entrySignalIndex = bar;
        let entryCandle = nextCandle;
        let confirmOk = true;
        if (useMomConfirm) {
          const confirmBar = candles[bar + 1];
          const entryBarCandle = candles[bar + 2];
          if (!confirmBar || !entryBarCandle) {
            confirmOk = false;
          } else {
            confirmOk = passesConfirmBar(signalBar, confirmBar, confirmMode, 'long').ok;
            entrySignalIndex = bar + 1;
            entryCandle = entryBarCandle;
          }
        }
        if (confirmOk) {
          const momPrice = getNextBarEntryPrice(
            candles,
            entrySignalIndex,
            'long',
            config.slippagePerSide,
          );
          if (momPrice != null) {
            const momAtr = momSignal.signals.atr as number;
            const momSwingLow = momSignal.signals.mom_swing_low as number | undefined;
            let momSl = momPrice - momAtr * 2.0;
            if (momSwingLow != null && momSwingLow > 0 && momSwingLow < momPrice) {
              momSl = Math.min(momSwingLow - momAtr * 0.2, momPrice - momAtr * 1.5);
            }
            const momTp = momPrice + momAtr * 3.0;
            let momPosSize = state.cash * V2_CONFIG.BASE_POSITION_PERCENT * momSignal.confidence;
            // Risk-based cap (same as TREND — was missing)
            const momStopDist = (momPrice - momSl) / momPrice;
            if (momStopDist > 0 && V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT > 0) {
              const momMaxRisk = config.budgetPerTicker * V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT;
              const momRiskCap = momMaxRisk / momStopDist;
              if (momPosSize > momRiskCap) momPosSize = momRiskCap;
            }
            if (momPosSize >= 10 && momPosSize <= state.cash) {
              const momQty = momPrice > 0 ? momPosSize / momPrice : 0;
              const entryBarIndex = entrySignalIndex + 1;
              state.cash -= momPosSize;
              state.openTrades.push({
                id: nextTradeId(ticker) + 'M',
                ticker, side: 'long', entryBar: entryBarIndex, entryPrice: momPrice,
                entryTime: entryCandle.time, entrySignals: momSignal.signals,
                entryRegime: momSignal.regime, entryConfidence: momSignal.confidence,
                compositeScore: momSignal.compositeScore,
                exitBar: null, exitPrice: null, exitTime: null, exitReason: null,
                quantity: momQty, positionSizeUsd: momPosSize, stopLoss: momSl, takeProfit: momTp,
                currentStop: momSl, trailingActivated: false, peakPrice: momPrice,
                pnlGross: null, pnlNet: null, feesPaid: 0,
                holdBars: 0, holdDurationMs: null, atrPercent: momAtrPct,
              });
            }
          }
        }
      }
    }
  }

  // Force-close any remaining open trades at last bar close
  const lastCandle = candles[candles.length - 1];
  const lastBar = candles.length - 1;
  for (const trade of state.openTrades) {
    // Never filled (entryBar past end of series) — refund reserved cash, drop.
    if (lastBar < trade.entryBar) {
      state.cash += trade.positionSizeUsd;
      continue;
    }
    const exitPrice = applyPaperSlippage(
      lastCandle.close,
      trade.side,
      'exit',
      config.slippagePerSide,
    );
    const pnlGross = trade.side === 'short'
      ? (trade.entryPrice - exitPrice) * trade.quantity
      : (exitPrice - trade.entryPrice) * trade.quantity;
    const feesPaid = trade.positionSizeUsd * config.feeRoundTrip;
    const pnlNet = pnlGross - feesPaid;
    const holdBars = lastBar - trade.entryBar;

    trade.exitBar = lastBar;
    trade.exitPrice = exitPrice;
    trade.exitTime = lastCandle.time;
    trade.exitReason = EXIT_REASON.time_kill;
    trade.pnlGross = pnlGross;
    trade.pnlNet = pnlNet;
    trade.feesPaid = feesPaid;
    trade.holdBars = holdBars;
    trade.holdDurationMs = holdBars * config.intervalMinutes * 60 * 1000;
    state.closedTrades.push(trade);
  }

  return state.closedTrades;
}

// --- Signal Score Computation ---

function computeSignalScores(trades: BacktestTrade[]): SignalScoreResult[] {
  const results: SignalScoreResult[] = [];

  for (const signalName of Object.keys(SIGNAL_ACTIVE_THRESHOLDS)) {
    const threshold = SIGNAL_ACTIVE_THRESHOLDS[signalName];

    let activeTrades = 0;
    let activeWins = 0;
    let activePnlSum = 0;
    let inactiveTrades = 0;
    let inactivePnlSum = 0;

    for (const trade of trades) {
      if (trade.pnlNet == null || trade.positionSizeUsd === 0) continue;

      const signalValue = trade.entrySignals[signalName];
      if (signalValue === undefined) continue;

      const pnlPercent = trade.pnlNet / trade.positionSizeUsd;

      if (threshold(signalValue)) {
        activeTrades++;
        activePnlSum += pnlPercent;
        if (trade.pnlNet > 0) activeWins++;
      } else {
        inactiveTrades++;
        inactivePnlSum += pnlPercent;
      }
    }

    const totalTrades = activeTrades + inactiveTrades;
    const winRate = activeTrades > 0 ? activeWins / activeTrades : 0;
    const avgPnlWhenActive = activeTrades > 0 ? activePnlSum / activeTrades : 0;
    const avgPnlWhenInactive = inactiveTrades > 0 ? inactivePnlSum / inactiveTrades : 0;
    const edge = avgPnlWhenActive - avgPnlWhenInactive;

    let verdict: 'proven' | 'negative' | 'inconclusive';
    if (totalTrades < V2_CONFIG.MIN_TRADES_FOR_SCORING) verdict = 'inconclusive';
    else if (edge > 0.003 && winRate > 0.55) verdict = 'proven';
    else if (edge < -0.002) verdict = 'negative';
    else verdict = 'inconclusive';

    results.push({
      signalName,
      totalTrades,
      winningTrades: activeWins,
      winRate,
      avgPnlWhenActive,
      avgPnlWhenInactive,
      edge,
      verdict,
    });
  }

  // Sort by edge descending
  results.sort((a, b) => b.edge - a.edge);
  return results;
}

// --- Summary Computation ---

function computeSummary(trades: BacktestTrade[], config: BacktestConfig): BacktestSummary {
  const closed = trades.filter((t) => t.pnlNet != null);
  const wins = closed.filter((t) => t.pnlNet! > 0);
  const losses = closed.filter((t) => t.pnlNet! <= 0);

  const totalPnlNet = closed.reduce((sum, t) => sum + t.pnlNet!, 0);
  const totalBudget = config.budgetPerTicker * config.tickers.length;

  const grossProfit = wins.reduce((sum, t) => sum + t.pnlNet!, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlNet!, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max drawdown (equity curve)
  let peak = 0;
  let equity = 0;
  let maxDrawdownUsd = 0;

  // Sort by exit time for equity curve
  const byExitTime = [...closed].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  for (const trade of byExitTime) {
    equity += trade.pnlNet!;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdownUsd) maxDrawdownUsd = drawdown;
  }

  const avgHoldBars = closed.length > 0
    ? closed.reduce((sum, t) => sum + t.holdBars, 0) / closed.length
    : 0;
  const avgHoldDurationMs = closed.length > 0
    ? closed.reduce((sum, t) => sum + (t.holdDurationMs ?? 0), 0) / closed.length
    : 0;

  // Best and worst trades
  let bestTrade: BacktestTrade | null = null;
  let worstTrade: BacktestTrade | null = null;
  for (const t of closed) {
    if (!bestTrade || t.pnlNet! > bestTrade.pnlNet!) bestTrade = t;
    if (!worstTrade || t.pnlNet! < worstTrade.pnlNet!) worstTrade = t;
  }

  return {
    totalTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    totalPnlNet,
    totalPnlPercent: totalBudget > 0 ? totalPnlNet / totalBudget : 0,
    avgWinPnl: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLossPnl: losses.length > 0 ? -grossLoss / losses.length : 0,
    profitFactor,
    maxDrawdownUsd,
    maxDrawdownPercent: totalBudget > 0 ? maxDrawdownUsd / totalBudget : 0,
    avgHoldBars,
    avgHoldDurationMs,
    bestTrade,
    worstTrade,
  };
}

// --- Regime Breakdown ---

function computeRegimeBreakdown(trades: BacktestTrade[]): RegimeBreakdown[] {
  const regimeMap = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const trade of trades) {
    if (trade.pnlNet == null) continue;
    const r = trade.entryRegime;
    const entry = regimeMap.get(r) ?? { trades: 0, wins: 0, pnl: 0 };
    entry.trades++;
    if (trade.pnlNet > 0) entry.wins++;
    entry.pnl += trade.pnlNet;
    regimeMap.set(r, entry);
  }

  return [...regimeMap.entries()]
    .map(([regime, data]) => ({
      regime,
      trades: data.trades,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
      totalPnl: data.pnl,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

// --- Ticker Breakdown ---

function computeTickerBreakdown(trades: BacktestTrade[]): TickerBreakdown[] {
  const tickerMap = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const trade of trades) {
    if (trade.pnlNet == null) continue;
    const t = trade.ticker;
    const entry = tickerMap.get(t) ?? { trades: 0, wins: 0, pnl: 0 };
    entry.trades++;
    if (trade.pnlNet > 0) entry.wins++;
    entry.pnl += trade.pnlNet;
    tickerMap.set(t, entry);
  }

  return [...tickerMap.entries()]
    .map(([ticker, data]) => ({
      ticker,
      trades: data.trades,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
      totalPnl: data.pnl,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

// --- Main Entry Point ---

/**
 * Run a full backtest across all tickers.
 * Downloads/caches candles, then replays bar-by-bar through the V2 pipeline.
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  _tradeCounter = 0;

  // Load all candles (cached or fresh from Kraken)
  const allCandles = await loadAllCandles(
    config.tickers,
    config.startDate,
    config.endDate,
    config.interval,
  );

  // Run simulation per ticker
  console.log('Running backtest simulation...');
  const allTrades: BacktestTrade[] = [];

  for (const [ticker, candles] of allCandles) {
    const trades = simulateTicker(ticker, candles, config);
    allTrades.push(...trades);
    const pnl = trades.reduce((sum, t) => sum + (t.pnlNet ?? 0), 0);
    const wins = trades.filter((t) => t.pnlNet != null && t.pnlNet > 0).length;
    console.log(`  ${ticker}: ${trades.length} trades, ${wins}W/${trades.length - wins}L, PnL $${pnl.toFixed(2)}`);
  }

  console.log(`\nTotal: ${allTrades.length} trades across ${allCandles.size} tickers\n`);

  // Compute analytics
  const summary = computeSummary(allTrades, config);
  const signalScores = computeSignalScores(allTrades);
  const regimeBreakdown = computeRegimeBreakdown(allTrades);
  const tickerBreakdown = computeTickerBreakdown(allTrades);

  return {
    config,
    trades: allTrades,
    summary,
    signalScores,
    regimeBreakdown,
    tickerBreakdown,
  };
}
