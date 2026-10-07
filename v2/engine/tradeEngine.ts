// ============================================
// Phoenix V2 Trade Engine Orchestrator
// Runs the full pipeline loop: scan → signal → risk → execute → exit
// ============================================

import type { Candle, V2Trade } from '../pipeline/types.ts';
import { V2_CONFIG, STRATEGY_TIMEFRAMES, getExchangeFees } from './config.ts';
import { tallyFailed } from './rejectionTally.ts';
import type { ExchangeAdapter } from '../exchange/types.ts';
import { applyPaperSlippage, calculateRealizedPnl } from './tradeAccounting.ts';

// Pipeline imports
import { scanMarket } from '../pipeline/marketScanner.ts';
import { evaluateRisk, getApproved, refreshFearGreedIfNeeded } from '../pipeline/riskGate.ts';
import { executeTrade } from '../pipeline/executor.ts';
import { checkExits } from '../pipeline/exitManager.ts';
import { fetchAllCandles, getRequiredTimeframes } from './candleManager.ts';
import { runAllStrategies } from './strategyRunner.ts';
import type { StrategySignal } from './strategyRunner.ts';
import {
  PROMOTE_ENTRY_QUALITY,
  advancePendingOnClosedBar,
  createPendingFromSignal,
  isEntryBarOpen,
  type EntryQualityConfig,
  type PendingConfirmEntry,
} from '../pipeline/pendingConfirmEntry.ts';
import { shouldForceUnlockLoop, shouldKickStaleLoop } from './loopWatchdog.ts';
import type { RiskResult } from '../pipeline/types.ts';

// Attribution imports
import {
  initV2Tables,
  insertTrade,
  closeTrade,
  resolveGatekeeperByEntry,
  getOpenTrades,
  getClosedTrades,
  appendTradeDecision,
} from '../attribution/attributionStore.ts';
import { analyzeClosedTrade } from '../attribution/postTradeAnalyzer.ts';

// Position management
import { loadPortfolio, getCircuitBreakerState } from './positionManager.ts';

// --- State ---

let loopTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let loopInProgress = false; // Prevents concurrent runLoop() calls
let loopStartedAt = 0; // wall-clock when loopInProgress became true
const LOOP_STALE_MULT = 3; // kick if lastLoopAt older than 3× BOT_LOOP_INTERVAL
const LOOP_MAX_MS = 5 * 60_000; // force-unlock hung loop after 5 min
let exchange: ExchangeAdapter | null = null;
let budget = 0;

/** Pending TREND confirm entries (signal → confirm → enter). Key: ticker. */
interface StashedPending {
  pending: PendingConfirmEntry;
  signal: StrategySignal;
  lastSeenClosedBarTime: number;
}
const _pendingConfirms = new Map<string, StashedPending>();

function candleIntervalMs(): number {
  const iv = V2_CONFIG.CANDLE_INTERVAL;
  if (iv === '1h') return 60 * 60 * 1000;
  if (iv === '15m') return 15 * 60 * 1000;
  if (iv === '1m') return 60 * 1000;
  return 4 * 60 * 60 * 1000; // 4h default (promote package)
}

function entryQualityConfig(): EntryQualityConfig {
  return {
    confirmMode: (V2_CONFIG as { ENTRY_CONFIRM_MODE?: EntryQualityConfig['confirmMode'] }).ENTRY_CONFIRM_MODE
      ?? PROMOTE_ENTRY_QUALITY.confirmMode,
    maxSignalCloseLocation: (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION?: number }).MAX_SIGNAL_CLOSE_LOCATION
      ?? PROMOTE_ENTRY_QUALITY.maxSignalCloseLocation,
    minSignalAtrPercent: V2_CONFIG.MIN_ATR_PERCENT,
    barIntervalMs: candleIntervalMs(),
  };
}

function confirmEnabled(): boolean {
  return !!(V2_CONFIG as { ENTRY_CONFIRM_ENABLED?: boolean }).ENTRY_CONFIRM_ENABLED;
}

// 2026-05-12: decision_log heartbeat dedup.
// checkOpenExits is called up to 3x per loop iteration. Without dedup we'd
// persist 3 identical heartbeat records each tick. Map keys are trade IDs;
// values are the last loopCount we persisted a decision for. State changes
// (stop moved / trail activated / exit) bypass this and persist unconditionally.
const _lastDecisionPersistLoop = new Map<string, number>();
const DECISION_HEARTBEAT_LOOPS = 30; // ~30 min on 60s BOT_LOOP_INTERVAL_MS

const stats = {
  lastLoopTime: 0,
  lastLoopAt: 0,
  loopCount: 0,
  rejectedByScan: 0,
  rejectedBySignal: 0,
  rejectedByRisk: 0,
  lastScanReasons: [] as { ticker: string; reason: string }[],
  candleCounts: {} as Record<string, number>,
  htfRegimes: {} as Record<string, string>,
};

// --- Status Interface ---

export interface V2EngineStatus {
  mode: string;
  isRunning: boolean;
  lastLoopTime: number;
  lastLoopAt: number;
  lastScanReasons?: { ticker: string; reason: string }[];
  candleCounts?: Record<string, number>;
  loopCount: number;
  rejectedByScan: number;
  rejectedBySignal: number;
  rejectedByRisk: number;
  htfRegimes?: Record<string, string>;
  openPositions: number;
  totalTrades: number;
  portfolioCash: number;
  totalPnlNet: number;
}

// --- Telegram Helper ---

async function sendEntryAlert(trade: V2Trade): Promise<void> {
  try {
    const tg = await import('../../services/telegramService.js');
    if (tg.isEnabled()) {
      const pullbackTag = trade.entryRegime === 'PULLBACK_UP' ? ' [PULLBACK]' : '';
      tg.alertTradeExecution({
        type: 'BUY',
        ticker: trade.ticker,
        price: trade.entryPrice,
        strategy: `${V2_CONFIG.TELEGRAM_TAG}${pullbackTag} ${trade.entryRegime} conf=${trade.entryConfidence.toFixed(2)}`,
      });
    }
  } catch {
    // Telegram not available
  }
}

async function sendExitAlert(trade: V2Trade, exitPrice: number, exitReason: string, pnlNet: number): Promise<void> {
  try {
    const tg = await import('../../services/telegramService.js');
    if (tg.isEnabled()) {
      tg.alertTradeExecution({
        type: 'SELL',
        ticker: trade.ticker,
        price: exitPrice,
        strategy: `${V2_CONFIG.TELEGRAM_TAG} ${exitReason}`,
        pnl: pnlNet,
      });
    }
  } catch {
    // Telegram not available
  }
}

// --- Init / Start / Stop ---

/**
 * Initialize the V2 engine with an exchange adapter and initial budget.
 */
export function initV2Engine(adapter: ExchangeAdapter, initialBudget: number): void {
  exchange = adapter;
  budget = initialBudget;
  initV2Tables();
  console.log(`[V2] Engine initialized: mode=${V2_CONFIG.MODE}, budget=$${initialBudget}, exchange=${adapter.getName()}`);
}

/**
 * Start the bot loop. Runs immediately then on interval.
 */
export function startV2Engine(): void {
  if (isRunning) {
    console.log('[V2] Engine already running');
    return;
  }
  if (!exchange) {
    throw new Error('[V2] Engine not initialized — call initV2Engine() first');
  }

  isRunning = true;
  console.log(`[V2] Engine started, loop interval=${V2_CONFIG.BOT_LOOP_INTERVAL_MS}ms`);

  // Run immediately
  runLoop();

  // Then on interval
  loopTimer = setInterval(() => {
    runLoop();
  }, V2_CONFIG.BOT_LOOP_INTERVAL_MS);

  // Wall-clock watchdog: Node timers freeze across VM suspend; lastLoopAt is
  // wall-clock so the monitor goes stale until setInterval catches up. Kick
  // (and unlock a hung mutex) using Date.now() so exits/entries resume promptly.
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    const now = Date.now();
    if (
      shouldForceUnlockLoop({
        loopInProgress,
        loopStartedAt,
        now,
        maxLoopMs: LOOP_MAX_MS,
      })
    ) {
      console.warn(
        `[V2] Watchdog force-unlock: loopInProgress held ${Math.round((now - loopStartedAt) / 1000)}s`,
      );
      loopInProgress = false;
      loopStartedAt = 0;
    }
    if (
      shouldKickStaleLoop({
        isRunning,
        lastLoopAt: stats.lastLoopAt,
        now,
        loopIntervalMs: V2_CONFIG.BOT_LOOP_INTERVAL_MS,
        staleMult: LOOP_STALE_MULT,
      })
    ) {
      console.warn(
        `[V2] Watchdog kick: lastLoopAt age ${Math.round((now - stats.lastLoopAt) / 1000)}s — running loop`,
      );
      void runLoop();
    }
  }, Math.min(30_000, V2_CONFIG.BOT_LOOP_INTERVAL_MS));
}

/**
 * Stop the bot loop.
 */
export function stopV2Engine(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  isRunning = false;
  console.log('[V2] Engine stopped');
}

/**
 * Get current engine status snapshot.
 */
export function getV2Status(): V2EngineStatus {
  // Main pipeline status: TREND + MOMENTUM (+ BREAKOUT when enabled) all
  // enter via runAllStrategies → tradeEngine. 2026-10-06: TREND-only filter
  // hid the contaminated AVAXUSD MOMENTUM open (health openPositions=0).
  // Separate engines (sniper/MR) still report via their own status endpoints.
  const openTrades = getOpenTrades();
  const closedTrades = getClosedTrades(1000);
  const totalPnlNet = closedTrades.reduce((sum, t) => sum + (t.pnlNet ?? 0), 0);

  return {
    mode: V2_CONFIG.MODE,
    isRunning,
    lastLoopTime: stats.lastLoopTime,
    lastLoopAt: stats.lastLoopAt,
    loopCount: stats.loopCount,
    rejectedByScan: stats.rejectedByScan,
    rejectedBySignal: stats.rejectedBySignal,
    rejectedByRisk: stats.rejectedByRisk,
    htfRegimes: stats.htfRegimes,
    openPositions: openTrades.length,
    totalTrades: closedTrades.length + openTrades.length,
    portfolioCash: budget + totalPnlNet,
    totalPnlNet,
    lastScanReasons: stats.lastScanReasons,
    candleCounts: stats.candleCounts,
  };
}

// --- Main Loop ---

async function runLoop(): Promise<void> {
  if (!exchange) return;

  // Concurrency guard: skip if previous loop is still running
  if (loopInProgress) {
    console.log('[V2] Loop skipped — previous iteration still running');
    return;
  }
  loopInProgress = true;
  loopStartedAt = Date.now();

  const loopStart = loopStartedAt;
  stats.loopCount++;

  try {
    // Wall-clock F&G refresh — setInterval pauses across VM suspend.
    await refreshFearGreedIfNeeded();

    // ==============================
    // Stage 0: Fetch candles (multi-timeframe)
    // ==============================
    const requiredTfs = getRequiredTimeframes(STRATEGY_TIMEFRAMES);
    const allCandles = await fetchAllCandles(V2_CONFIG.SCAN_TICKERS as unknown as string[], requiredTfs);

    if (allCandles.size === 0) {
      console.log('[V2] No candle data available, skipping loop');
      stats.lastLoopTime = Date.now() - loopStart;
      await checkOpenExits();
      return;
    }

    // Track candle counts for diagnostics (use primary TF)
    stats.candleCounts = {};
    for (const [ticker, tfMap] of allCandles) {
      const primaryCandles = tfMap.get(V2_CONFIG.CANDLE_INTERVAL) ?? tfMap.values().next().value;
      if (primaryCandles) stats.candleCounts[ticker] = primaryCandles.length;
    }

    // Build primary-TF tickerCandles for scan reasons (backward compat with status API)
    const tickerCandles = new Map<string, Candle[]>();
    for (const [ticker, tfMap] of allCandles) {
      const candles = tfMap.get(V2_CONFIG.CANDLE_INTERVAL);
      if (candles) tickerCandles.set(ticker, candles);
    }

    // Market scan on primary timeframe for diagnostics/logging
    const scanResults = scanMarket(tickerCandles);
    stats.lastScanReasons = scanResults.map(r => ({ ticker: r.ticker, reason: r.reason || (r.passed ? 'PASS' : 'UNKNOWN') }));
    stats.rejectedByScan += tallyFailed(scanResults);
    // htfRegimes was declared and returned by getV2Status() but never written,
    // so every consumer read {} and reported regime UNKNOWN. Populate it here.
    stats.htfRegimes = Object.fromEntries(scanResults.map(r => [r.ticker, r.regime]));
    if (stats.loopCount % 10 === 1) {
      for (const r of scanResults) {
        if (!r.passed) console.log(`[V2] REJECT ${r.ticker}: ${r.reason}`);
      }
    }

    // ==============================
    // Stage 1+2: Multi-Strategy Signal Generation
    // ==============================
    // Runs TREND, MOMENTUM, BREAKOUT, MEAN_REVERSION, SCALP on their optimal TFs
    const allSignals = runAllStrategies(allCandles, V2_CONFIG.SCAN_TICKERS as unknown as string[]);
    const passedSignals = allSignals.filter(s => s.passed);
    stats.rejectedBySignal += tallyFailed(allSignals);

    if (passedSignals.length === 0) {
      if (stats.loopCount % 5 === 1) {
        console.log(`[V2] Loop #${stats.loopCount}: no signals from any strategy across ${requiredTfs.length} timeframes`);
      }
      // Still advance/fill pending confirms — they mature on closed bars without new signals.
      if (confirmEnabled() && _pendingConfirms.size > 0) {
        await processPendingConfirmEntries(allCandles, tickerCandles, false);
      }
      stats.lastLoopTime = Date.now() - loopStart;
      await checkOpenExits();
      return;
    }

    if (stats.loopCount % 5 === 1) {
      const sigSummary = passedSignals.map(s => `${s.ticker}/${(s as StrategySignal)._strategy}/${(s as StrategySignal)._timeframe}=${s.confidence.toFixed(2)}`).join(', ');
      console.log(`[V2] Loop #${stats.loopCount}: ${passedSignals.length} signals: [${sigSummary}]`);
    }

    // ==============================
    // Stage 3: Risk Gate
    // ==============================
    // Load ALL open positions (not just TREND) so riskGate sees MOMENTUM/BREAKOUT/SCALP too
    const portfolio = loadPortfolio(budget);
    const cbState = getCircuitBreakerState(portfolio);
    const riskResults = evaluateRisk(passedSignals, portfolio, cbState, exchange?.getName() ?? 'kraken', tickerCandles);
    const approved = getApproved(riskResults);
    const riskRejections = riskResults.length - approved.length;
    stats.rejectedByRisk += riskRejections;

    // ==============================
    // Stage 4: ML Gatekeeper (optional)
    // ==============================
    let mlFiltered = approved;
    // Gatekeeper A/B: on a fraction of loops, bypass the gatekeeper entirely (OFF arm)
    // so we can measure its block-recall — do the trades it would block actually lose?
    const abOff = V2_CONFIG.ML_GATEKEEPER_ENABLED
      && V2_CONFIG.GATEKEEPER_AB_TEST
      && Math.random() < V2_CONFIG.GATEKEEPER_AB_OFF_RATE;
    if (V2_CONFIG.ML_GATEKEEPER_ENABLED && approved.length > 0 && abOff) {
      mlFiltered = approved; // all approved proceed at 1.0x size (no ML multiplier)
      console.log(`[V2] Loop #${stats.loopCount}: GATEKEEPER A/B OFF arm — bypassing gatekeeper for ${approved.length} signal(s)`);
    } else if (V2_CONFIG.ML_GATEKEEPER_ENABLED && approved.length > 0) {
      try {
        const gk = await import('../../services/mlGatekeeper.js');
        if (gk.evaluateEntry) {
          const mlResults = [];
          for (const risk of approved) {
            // Match side too — a long and a short on the same ticker can both
            // survive strategyRunner's ticker:side dedup; ticker-only find()
            // could pair a short risk result with the long signal's prices.
            const signal = passedSignals.find((s) => s.ticker === risk.ticker && (s.side ?? 'long') === (risk.side ?? 'long'));
            if (!signal) continue;
            const candles = tickerCandles.get(risk.ticker);
            if (!candles || candles.length < 50) { mlResults.push(risk); continue; }
            // Convert V2 candles to {o,h,l,c,v} format expected by feature engineering
            const fmtCandles = candles.map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
            const gate = gk.evaluateEntry(risk.ticker, fmtCandles, 'TREND', signal.confidence, {});
            if (gate.proceed) {
              // Apply ML size multiplier
              if (gate.sizeMultiplier && gate.sizeMultiplier !== 1.0) {
                risk.positionSizeUsd *= gate.sizeMultiplier;
                // Re-apply the risk cap AFTER the multiplier. The gatekeeper
                // can scale up to 1.5x, which silently breached
                // MAX_RISK_PER_TRADE_PERCENT (riskGate clamps BEFORE this).
                const closePrice = (signal.signals.close_price as number) || 1;
                const stopDistPercent = risk.stopLoss > 0 ? Math.abs(closePrice - risk.stopLoss) / closePrice : 0;
                if (stopDistPercent > 0) {
                  const maxRiskUsd = Math.min(
                    portfolio.totalEquity * V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT,
                    V2_CONFIG.MAX_RISK_PER_TRADE_USD,
                  );
                  risk.positionSizeUsd = Math.min(risk.positionSizeUsd, maxRiskUsd / stopDistPercent);
                }
                // Downward multipliers (0.5x) can also drop below Kraken's $10 min
                if (!isFinite(risk.positionSizeUsd) || risk.positionSizeUsd < 10) {
                  stats.rejectedByRisk++;
                  console.log(`[V2] ML SIZE REJECT ${risk.ticker}: $${risk.positionSizeUsd.toFixed(2)} below $10 min after ${gate.sizeMultiplier}x multiplier`);
                  continue;
                }
                risk.quantity = risk.positionSizeUsd / closePrice;
              }
              mlResults.push(risk);
            } else {
              stats.rejectedByRisk++;
              if (stats.loopCount % 5 === 1) {
                console.log(`[V2] ML REJECT ${risk.ticker}: ${gate.reason} (tier=${gate.tier}, conf=${gate.confidence?.toFixed(1)}%)`);
              }
            }
          }
          mlFiltered = mlResults;
        }
      } catch (e) {
        // ML import or evaluation failed — pass approved signals through
        // unfiltered. Log so a real bug doesn't silently disable ML gating.
        if (stats.loopCount % 30 === 1) {
          console.warn(`[V2] ML gatekeeper bypassed (${(e as Error).message}) — ${approved.length} signals passed through unfiltered`);
        }
      }
    }

    // ==============================
    // Stage 5: Pending confirm advance + execute / stash TREND+MOMENTUM signals
    // ==============================
    let executedThisLoop = false;

    if (confirmEnabled()) {
      executedThisLoop = await processPendingConfirmEntries(allCandles, tickerCandles, abOff);
    }

    if (!executedThisLoop && mlFiltered.length > 0) {
      // Take the best (first, since signals are sorted by score)
      const bestRisk = mlFiltered[0];
      const bestSignal = passedSignals.find((s) => s.ticker === bestRisk.ticker && (s.side ?? 'long') === (bestRisk.side ?? 'long'));

      if (bestSignal) {
        const strategy = (bestSignal as StrategySignal)._strategy ?? 'TREND';
        // 2026-10-06: MOMENTUM joins confirm (was TREND-only). Research under
        // ADX20: earlier unchanged, OOS PF/net improved vs next-bar MOMENTUM.
        const useConfirm = confirmEnabled() && (strategy === 'TREND' || strategy === 'MOMENTUM');

        if (useConfirm) {
          stashTrendPending(bestSignal, allCandles);
        } else {
          executedThisLoop = await openApprovedTrade(bestSignal, bestRisk, tickerCandles, abOff);
        }
      }
    } else if (!executedThisLoop && approved.length > 0 && mlFiltered.length === 0) {
      // Had risk-approved trades but ML rejected them all
      console.log(`[V2] Loop #${stats.loopCount}: ML rejected all ${approved.length} risk-approved signals`);
    } else if (!executedThisLoop && approved.length === 0 && passedSignals.length > 0) {
      // Log risk rejection reasons every 5 loops
      if (stats.loopCount % 5 === 1) {
        for (const r of riskResults) {
          if (!r.passed) console.log(`[V2] RISK REJECT ${r.ticker}: ${r.reason}`);
        }
      }
      console.log(`[V2] Loop #${stats.loopCount}: risk rejected all ${riskResults.length} signals (${scanResults.filter(r => r.passed).length} scanned, ${passedSignals.length} signaled)`);
    }

    // Shorts are now handled by strategyRunner (Stage 1+2) — no separate pipeline needed

    // ==============================
    // Stage 6: Check exits
    // ==============================
    await checkOpenExits();

    stats.lastLoopTime = Date.now() - loopStart;
    console.log(`[V2] Loop #${stats.loopCount} completed in ${stats.lastLoopTime}ms`);
  } catch (e) {
    const err = e as Error;
    console.error(`[V2] Loop error: ${err.message}`);
    if (err.stack) console.error(`[V2] Stack: ${err.stack.split('\n').slice(1, 4).join(' | ')}`);
    stats.lastLoopTime = Date.now() - loopStart;
  } finally {
    stats.lastLoopAt = Date.now();
    loopInProgress = false;
    loopStartedAt = 0;
  }
}

// --- Pending confirm helpers (promote package) ---

function stashTrendPending(
  signal: StrategySignal,
  allCandles: Map<string, Map<string, Candle[]>>,
): void {
  const tf = signal._timeframe || V2_CONFIG.CANDLE_INTERVAL;
  const candles = allCandles.get(signal.ticker)?.get(tf);
  if (!candles || candles.length < 1) {
    console.log(`[V2] CONFIRM skip ${signal.ticker}: no candles for ${tf}`);
    return;
  }
  const signalBar = candles[candles.length - 1]!;
  const atr = Number(signal.signals.atr) || 0;
  const atrPercent = Number(signal.signals.atr_percent) || 0;
  const side = (signal.side ?? 'long') as 'long' | 'short';
  const key = signal.ticker;
  const existing = _pendingConfirms.get(key);
  if (existing && existing.pending.signalBarTime === signalBar.time) {
    return; // already tracking this signal bar
  }
  const created = createPendingFromSignal(
    signal.ticker,
    signalBar,
    atr,
    atrPercent,
    entryQualityConfig(),
    side,
  );
  if (!created.ok) {
    // Always log — confirm rejects are rare soak signals; rate-limiting hid them
    // between %5 loops while the same 4h bar kept re-signaling every minute.
    console.log(`[V2] CONFIRM reject ${signal.ticker}: ${created.reason}`);
    return;
  }
  _pendingConfirms.set(key, {
    pending: created.pending,
    signal,
    lastSeenClosedBarTime: signalBar.time,
  });
  console.log(
    `[V2] CONFIRM pending ${signal.ticker}: await_confirm signalBar=${new Date(signalBar.time).toISOString()} score=${signal.compositeScore.toFixed(1)}`,
  );
}

async function processPendingConfirmEntries(
  allCandles: Map<string, Map<string, Candle[]>>,
  tickerCandles: Map<string, Candle[]>,
  abOff: boolean,
): Promise<boolean> {
  const cfg = entryQualityConfig();
  let executed = false;

  for (const [key, stashed] of [..._pendingConfirms.entries()]) {
    const tf = stashed.signal._timeframe || V2_CONFIG.CANDLE_INTERVAL;
    const candles = allCandles.get(key)?.get(tf);
    if (!candles || candles.length < 1) continue;
    const last = candles[candles.length - 1]!;

    if (last.time > stashed.lastSeenClosedBarTime) {
      const adv = advancePendingOnClosedBar(stashed.pending, last, cfg);
      stashed.lastSeenClosedBarTime = last.time;
      if (adv.action === 'drop' || !adv.pending) {
        console.log(
          `[V2] CONFIRM drop ${key} at bar ${new Date(last.time).toISOString()}`
            + (adv.reason ? `: ${adv.reason}` : ''),
        );
        _pendingConfirms.delete(key);
        continue;
      }
      stashed.pending = adv.pending;
      if (adv.action === 'arm_entry') {
        console.log(`[V2] CONFIRM armed ${key}: ready_enter after ${new Date(last.time).toISOString()}`);
      }
    }

    if (!isEntryBarOpen(stashed.pending, stashed.lastSeenClosedBarTime)) continue;
    if (executed) continue; // one entry per loop

    // Re-run risk at entry time (portfolio may have changed since signal)
    const portfolio = loadPortfolio(budget);
    const cbState = getCircuitBreakerState(portfolio);
    const riskResults = evaluateRisk(
      [stashed.signal],
      portfolio,
      cbState,
      exchange?.getName() ?? 'kraken',
      tickerCandles,
    );
    const approved = getApproved(riskResults);
    if (approved.length === 0) {
      console.log(`[V2] CONFIRM entry risk-reject ${key}: ${riskResults[0]?.reason ?? 'unknown'}`);
      _pendingConfirms.delete(key);
      continue;
    }

    console.log(`[V2] CONFIRM entering ${key} score=${stashed.signal.compositeScore.toFixed(1)}`);
    const ok = await openApprovedTrade(stashed.signal, approved[0]!, tickerCandles, abOff);
    _pendingConfirms.delete(key);
    if (ok) executed = true;
  }

  return executed;
}

async function openApprovedTrade(
  bestSignal: StrategySignal,
  bestRisk: RiskResult,
  tickerCandles: Map<string, Candle[]>,
  abOff: boolean,
): Promise<boolean> {
  if (!exchange) return false;
  console.log(`[V2] Loop #${stats.loopCount}: executing ${bestSignal.ticker} score=${bestSignal.compositeScore.toFixed(1)} size=$${bestRisk.positionSizeUsd.toFixed(2)}`);

  const { trade, decision } = await executeTrade(
    bestSignal,
    bestRisk,
    exchange,
    [],
  );

  if (!trade) {
    console.log(`[V2] Trade execution failed: ${decision.reason}`);
    return false;
  }

  // H4: insertTrade can throw (DB locked, schema drift, disk full).
  try {
    insertTrade(trade);
    console.log(`[V2] Trade opened: ${trade.ticker} @ $${trade.entryPrice.toFixed(2)} qty=${trade.quantity.toFixed(6)}`);
    await sendEntryAlert(trade);

    if (abOff) {
      try {
        const gk = await import('../../services/mlGatekeeper.js');
        const cs = tickerCandles.get(bestRisk.ticker);
        if (gk.evaluateEntry && cs && cs.length >= 50) {
          const fmt = cs.map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
          const wd = gk.evaluateEntry(bestRisk.ticker, fmt, 'TREND', bestSignal.confidence, {});
          if (!wd.proceed) {
            const { insertGatekeeperDecision } = await import('../../services/database.js');
            insertGatekeeperDecision({
              ticker: bestRisk.ticker, decision: 'PROCEED_AB',
              ml_confidence: wd.confidence ? wd.confidence / 100 : 0, tier: wd.tier || '',
              final_size_multiplier: 1.0,
              reason: `AB-OFF forced through (gatekeeper would BLOCK: ${wd.reason})`,
            });
          }
        }
      } catch { /* shadow logging is best-effort */ }
    }
    return true;
  } catch (insertErr) {
    const ie = insertErr as Error;
    console.error(`[V2] insertTrade failed for ${trade.ticker}: ${ie.message}`);
    if (V2_CONFIG.MODE === 'live') {
      try {
        if (trade.stopOrderId) {
          try {
            await exchange.cancelOrder(trade.stopOrderId);
          } catch (cancelErr) {
            console.error(`[V2] WARNING: could not cancel native SL ${trade.stopOrderId} during rollback: ${(cancelErr as Error).message}. Cancel it manually on Kraken.`);
          }
        }
        await exchange.placeMarketSell(trade.ticker, trade.quantity);
        console.error(`[V2] Position rolled back via market sell after insertTrade failure`);
      } catch (rollbackErr) {
        const re = rollbackErr as Error;
        console.error(`[V2] CRITICAL: insertTrade + rollback BOTH failed for ${trade.ticker}: ${re.message}. Position is naked on exchange (native SL still in place but no managed exits). Manual intervention required.`);
      }
    }
    return false;
  }
}

/** Test helper — clear pending confirm state between unit tests. */
export function _resetPendingConfirmsForTests(): void {
  _pendingConfirms.clear();
}

export function _pendingConfirmCountForTests(): number {
  return _pendingConfirms.size;
}

// --- Exit Check Helper ---

async function checkOpenExits(): Promise<void> {
  if (!exchange) return;

  // Get ALL open trades (TREND + MOMENTUM + shorts) — one exit manager handles all
  const openTrades = getOpenTrades();
  if (openTrades.length === 0) return;

  try {
    const exitResults = await checkExits(openTrades, exchange);

    for (const result of exitResults) {
      // Persist the decision when it's worth seeing later:
      //  - shouldExit (always persist the final decision)
      //  - state change (stop moved, trailing just activated)
      //  - periodic heartbeat (every DECISION_HEARTBEAT_LOOPS, dedup'd per trade)
      //
      // Without this, a silently-broken exit loop (like the krakenAdapter
      // NaN bug in commit 70bcafa) leaves no trace — decision_log only had
      // the entry record. Now post-entry behavior is observable.
      const tradeId = result.trade.id;
      const stopChanged = result.newStop !== result.trade.currentStop;
      const isStateChange = stopChanged || result.trailingJustActivated || result.shouldExit;
      const heartbeatDue =
        stats.loopCount % DECISION_HEARTBEAT_LOOPS === 0 &&
        _lastDecisionPersistLoop.get(tradeId) !== stats.loopCount;

      if (isStateChange || heartbeatDue) {
        try {
          appendTradeDecision(tradeId, result.decision);
          _lastDecisionPersistLoop.set(tradeId, stats.loopCount);
        } catch (e) {
          // Non-fatal — observability failure should never break exit logic.
          console.warn(`[V2] decision_log append failed for ${result.trade.ticker}: ${(e as Error).message}`);
        }
      }

      if (!result.shouldExit || !result.exitReason) continue;

      const trade = result.trade;

      // In live mode, actually sell. C2: cancel the native SL FIRST so it
      // doesn't fire later on the next re-entry's price dip and accidentally
      // close the fresh position. Cancel is best-effort — if it fails (already
      // filled, or just rejected), proceed with the market-sell anyway and
      // let the exchange reject one of the two if it ever races. Logging
      // captures both cases for diagnosis.
      let exitPrice = result.exitPrice;
      let reportedExitFee: number | null = null;
      if (V2_CONFIG.MODE === 'live') {
        if (trade.stopOrderId) {
          try {
            await exchange.cancelOrder(trade.stopOrderId);
          } catch (e) {
            console.warn(`[V2] cancelOrder(SL ${trade.stopOrderId}) for ${trade.ticker} failed: ${(e as Error).message} — proceeding with market sell`);
          }
        }
        try {
          const exitOrder = await exchange.placeMarketSell(trade.ticker, trade.quantity);
          if (exitOrder.price > 0) exitPrice = exitOrder.price;
          if (exitOrder.fee > 0) reportedExitFee = exitOrder.fee;
        } catch (e) {
          console.error(`[V2] Failed to place market sell for ${trade.ticker}: ${(e as Error).message}`);
          continue;
        }
      } else {
        exitPrice = applyPaperSlippage(
          exitPrice,
          trade.side,
          'exit',
          V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
        );
      }

      // Calculate fees from the actual live fill or the adverse paper fill.
      const entryFee = trade.feesPaid;
      const fees = getExchangeFees(exchange.getName());
      const exitFee = reportedExitFee
        ?? exitPrice * trade.quantity * fees.TAKER_PERCENT;
      const totalFees = entryFee + exitFee;

      // Close in DB
      closeTrade(trade.id, exitPrice, result.exitReason, totalFees);
      _lastDecisionPersistLoop.delete(trade.id); // Trade closed; clear heartbeat tracker

      // Analyze for signal scoring
      const { pnlGross, pnlNet } = calculateRealizedPnl(
        trade.side,
        trade.entryPrice,
        exitPrice,
        trade.quantity,
        totalFees,
      );
      const closedTrade = {
        ...trade,
        exitPrice,
        exitTime: Date.now(),
        exitReason: result.exitReason,
        pnlGross,
        pnlNet,
        feesPaid: totalFees,
        holdDurationMs: Date.now() - trade.entryTime,
        status: 'closed' as const,
      };
      analyzeClosedTrade(closedTrade);

      // Wire the ML gatekeeper feedback loop: record whether its entry decision
      // panned out (was NULL on every row before this — accuracy was unmeasurable).
      // Use a sign-correct realized PnL (closedTrade.pnlNet above omits the short-side
      // multiplier, so it would misclassify short wins as losses).
      try {
        resolveGatekeeperByEntry(trade.ticker, trade.entryTime, pnlNet > 0 ? 'WIN' : 'LOSS');
      } catch (e) {
        console.warn(`[V2] gatekeeper resolve failed for ${trade.ticker}: ${(e as Error).message}`);
      }

      console.log(`[V2] Trade closed: ${trade.ticker} @ $${exitPrice.toFixed(2)} reason=${result.exitReason} PnL=$${pnlNet.toFixed(2)}`);
      await sendExitAlert(trade, exitPrice, result.exitReason, pnlNet);
    }
  } catch (e) {
    console.error(`[V2] Exit check error: ${(e as Error).message}`);
  }
}
