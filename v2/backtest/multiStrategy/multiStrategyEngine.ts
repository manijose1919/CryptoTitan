import type { Candle } from '../../pipeline/types.ts';
import type { StrategyConfig, MSTrade, StrategyResult, StrategySummary, MSReport, ComparisonRow } from './types.ts';
import { computeSignals, detectRegime } from '../../indicators/indicators.ts';
import { detectEntry } from './entryDetectors.ts';
import { checkStrategyExit } from './exitHandlers.ts';
import { loadAllCandles } from '../candleCache.ts';
import { applyPaperSlippage } from '../../engine/tradeAccounting.ts';

const MIN_CANDLES = 50;
let _tradeCounter = 0;

/** Fee-aware execution controls. Defaults preserve legacy same-bar behavior. */
export interface MSExecutionOpts {
  /** Signal on bar N, fill at bar N+1 open (causal). Default false (legacy). */
  nextBarOpen?: boolean;
  /** Adverse slippage per side (e.g. 0.0005). Default 0. */
  slippagePerSide?: number;
  /**
   * When true (default if nextBarOpen): if bar opens through the stop,
   * fill at open instead of the stop price (gap-aware).
   */
  gapAwareStops?: boolean;
}

function nextId(strategy: string, ticker: string): string {
  return `ms_${strategy}_${ticker}_${++_tradeCounter}`;
}

function intervalToMinutes(interval: string): number {
  if (interval === '15m') return 15;
  if (interval === '1h') return 60;
  if (interval === '4h') return 240;
  if (interval === '1d') return 1440;
  return 60;
}

function scaleStopsForFill(
  signalEntry: number,
  fillEntry: number,
  stopLoss: number,
  takeProfit: number,
): { stopLoss: number; takeProfit: number } {
  if (!(signalEntry > 0) || fillEntry === signalEntry) {
    return { stopLoss, takeProfit };
  }
  const scale = fillEntry / signalEntry;
  return {
    stopLoss: stopLoss * scale,
    takeProfit: takeProfit > 0 ? takeProfit * scale : takeProfit,
  };
}

function simulateTicker(
  ticker: string,
  candles: Candle[],
  strategy: StrategyConfig,
  timeframe: string,
  budget: number,
  feeRoundTrip: number,
  exec: MSExecutionOpts = {},
): MSTrade[] {
  const intervalMin = intervalToMinutes(timeframe);
  const nextBarOpen = exec.nextBarOpen === true;
  const slip = exec.slippagePerSide ?? 0;
  const gapAware = exec.gapAwareStops ?? nextBarOpen;
  let cash = budget;
  const openTrades: MSTrade[] = [];
  const closedTrades: MSTrade[] = [];

  type Pending = {
    signalBar: number;
    confidence: number;
    signalEntry: number;
    stopLoss: number;
    takeProfit: number;
    entryRegime: string;
    atrPercent: number;
    metadata: Record<string, number>;
  };
  let pending: Pending | null = null;

  const lastSignalBar = nextBarOpen ? candles.length - 2 : candles.length - 1;

  for (let bar = MIN_CANDLES; bar <= lastSignalBar; bar++) {
    const window = candles.slice(0, bar + 1);
    const currentBar = candles[bar];

    // Fill pending next-bar entry at this open (before exits so same-bar risk applies).
    if (nextBarOpen && pending && pending.signalBar === bar - 1) {
      if (openTrades.length < strategy.maxOpenPositions && cash > 0) {
        const rawOpen = currentBar.open;
        const fillEntry = applyPaperSlippage(rawOpen, 'long', 'entry', slip);
        const scaled = scaleStopsForFill(pending.signalEntry, fillEntry, pending.stopLoss, pending.takeProfit);
        const equity = cash + openTrades.reduce((s, t) => s + t.positionSizeUsd, 0);
        let posSize = equity * strategy.positionSizePercent * pending.confidence;
        const maxPos = equity * strategy.maxPositionPercent;
        if (posSize > maxPos) posSize = maxPos;
        if (posSize > cash) posSize = cash;
        if (posSize >= 5) {
          const qty = posSize / fillEntry;
          openTrades.push({
            id: nextId(strategy.name, ticker),
            strategy: strategy.name,
            ticker,
            timeframe,
            entryBar: bar,
            entryPrice: fillEntry,
            entryTime: currentBar.time,
            entryRegime: pending.entryRegime,
            entryConfidence: pending.confidence,
            exitBar: null,
            exitPrice: null,
            exitTime: null,
            exitReason: null,
            quantity: qty,
            positionSizeUsd: posSize,
            stopLoss: scaled.stopLoss,
            takeProfit: scaled.takeProfit,
            currentStop: scaled.stopLoss,
            trailingActivated: false,
            peakPrice: fillEntry,
            peakHistogram: pending.metadata.peakHistogram ?? 0,
            pnlGross: null,
            pnlNet: null,
            feesPaid: 0,
            holdBars: 0,
            holdDurationMs: null,
            atrPercent: pending.atrPercent,
            metadata: pending.metadata,
          });
          cash -= posSize;
        }
      }
      pending = null;
    }

    // Check exits first
    const stillOpen: MSTrade[] = [];
    for (const trade of openTrades) {
      const holdBars = bar - trade.entryBar;

      let currentHist: number | undefined;
      if (strategy.exitParams.trailingMethod === 'histogram_decay') {
        const { signals: sig } = computeSignals(window);
        currentHist = sig.macd_histogram as number;
      }

      const result = checkStrategyExit(trade, currentBar, holdBars, intervalMin, strategy.exitParams, currentHist);
      trade.currentStop = result.newStop;
      trade.trailingActivated = result.trailingActivated;
      trade.peakHistogram = result.peakHistogram;

      if (result.shouldExit) {
        let exitPrice = result.exitPrice;
        if (gapAware && result.exitReason === 'stop_loss' && currentBar.open <= trade.currentStop) {
          exitPrice = currentBar.open;
        }
        if (slip > 0) {
          exitPrice = applyPaperSlippage(exitPrice, 'long', 'exit', slip);
        }
        const pnlGross = (exitPrice - trade.entryPrice) * trade.quantity;
        const fees = trade.positionSizeUsd * feeRoundTrip;
        trade.exitBar = bar;
        trade.exitPrice = exitPrice;
        trade.exitTime = currentBar.time;
        trade.exitReason = result.exitReason;
        trade.pnlGross = pnlGross;
        trade.pnlNet = pnlGross - fees;
        trade.feesPaid = fees;
        trade.holdBars = holdBars;
        trade.holdDurationMs = holdBars * intervalMin * 60 * 1000;
        cash += trade.positionSizeUsd + (trade.pnlNet ?? 0);
        closedTrades.push(trade);
      } else {
        stillOpen.push(trade);
      }
    }
    openTrades.length = 0;
    openTrades.push(...stillOpen);

    // Detect entry signal on this bar
    if (openTrades.length >= strategy.maxOpenPositions) continue;
    if (cash <= 0) continue;

    const { signals } = computeSignals(window);
    const regimeResult = detectRegime(window);
    const entry = detectEntry(strategy, window, signals, regimeResult);

    if (!entry.shouldEnter) continue;

    if (nextBarOpen) {
      // Queue for fill at next open (causal).
      pending = {
        signalBar: bar,
        confidence: entry.confidence,
        signalEntry: entry.entryPrice,
        stopLoss: entry.stopLoss,
        takeProfit: entry.takeProfit,
        entryRegime: regimeResult.regime,
        atrPercent: (signals.atr_percent as number) ?? 0,
        metadata: entry.metadata,
      };
      continue;
    }

    // Legacy same-bar fill path
    const equity = cash + openTrades.reduce((s, t) => s + t.positionSizeUsd, 0);
    let posSize = equity * strategy.positionSizePercent * entry.confidence;
    const maxPos = equity * strategy.maxPositionPercent;
    if (posSize > maxPos) posSize = maxPos;
    if (posSize > cash) posSize = cash;
    if (posSize < 5) continue;

    const fillEntry = slip > 0
      ? applyPaperSlippage(entry.entryPrice, 'long', 'entry', slip)
      : entry.entryPrice;
    const scaled = scaleStopsForFill(entry.entryPrice, fillEntry, entry.stopLoss, entry.takeProfit);
    const qty = posSize / fillEntry;

    const trade: MSTrade = {
      id: nextId(strategy.name, ticker),
      strategy: strategy.name,
      ticker,
      timeframe,
      entryBar: bar,
      entryPrice: fillEntry,
      entryTime: currentBar.time,
      entryRegime: regimeResult.regime,
      entryConfidence: entry.confidence,
      exitBar: null,
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      quantity: qty,
      positionSizeUsd: posSize,
      stopLoss: scaled.stopLoss,
      takeProfit: scaled.takeProfit,
      currentStop: scaled.stopLoss,
      trailingActivated: false,
      peakPrice: fillEntry,
      peakHistogram: entry.metadata.peakHistogram ?? 0,
      pnlGross: null,
      pnlNet: null,
      feesPaid: 0,
      holdBars: 0,
      holdDurationMs: null,
      atrPercent: signals.atr_percent as number ?? 0,
      metadata: entry.metadata,
    };

    cash -= posSize;
    openTrades.push(trade);
  }

  // Force close remaining
  for (const trade of openTrades) {
    const lastBar = candles[candles.length - 1];
    const holdBars = candles.length - 1 - trade.entryBar;
    let exitPrice = lastBar.close;
    if (slip > 0) exitPrice = applyPaperSlippage(exitPrice, 'long', 'exit', slip);
    const pnlGross = (exitPrice - trade.entryPrice) * trade.quantity;
    const fees = trade.positionSizeUsd * feeRoundTrip;
    trade.exitBar = candles.length - 1;
    trade.exitPrice = exitPrice;
    trade.exitTime = lastBar.time;
    trade.exitReason = 'force_close';
    trade.pnlGross = pnlGross;
    trade.pnlNet = pnlGross - fees;
    trade.feesPaid = fees;
    trade.holdBars = holdBars;
    trade.holdDurationMs = holdBars * intervalToMinutes(timeframe) * 60 * 1000;
    closedTrades.push(trade);
  }

  return closedTrades;
}

function computeSummary(trades: MSTrade[], budget: number): StrategySummary {
  const winners = trades.filter(t => (t.pnlNet ?? 0) > 0);
  const losers = trades.filter(t => (t.pnlNet ?? 0) <= 0);
  const totalPnl = trades.reduce((s, t) => s + (t.pnlNet ?? 0), 0);
  const grossWins = winners.reduce((s, t) => s + (t.pnlNet ?? 0), 0);
  const grossLosses = Math.abs(losers.reduce((s, t) => s + (t.pnlNet ?? 0), 0));

  let maxDD = 0, peak = budget, equity = budget;
  for (const t of trades) {
    equity += t.pnlNet ?? 0;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: trades.length > 0 ? winners.length / trades.length : 0,
    totalPnlNet: totalPnl,
    totalPnlPercent: budget > 0 ? (totalPnl / budget) * 100 : 0,
    avgWinPnl: winners.length > 0 ? grossWins / winners.length : 0,
    avgLossPnl: losers.length > 0 ? -grossLosses / losers.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    maxDrawdownPercent: maxDD * 100,
    avgHoldBars: trades.length > 0 ? trades.reduce((s, t) => s + t.holdBars, 0) / trades.length : 0,
  };
}

function buildResult(
  strategy: StrategyConfig,
  timeframe: string,
  budget: number,
  trades: MSTrade[],
): StrategyResult {
  const summary = computeSummary(trades, budget);

  const exitMap = new Map<string, { count: number; pnl: number }>();
  const tickerMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  const regimeMap = new Map<string, { trades: number; wins: number; pnl: number }>();

  for (const t of trades) {
    const er = t.exitReason ?? 'unknown';
    const e = exitMap.get(er) ?? { count: 0, pnl: 0 };
    e.count++; e.pnl += t.pnlNet ?? 0;
    exitMap.set(er, e);

    const tk = tickerMap.get(t.ticker) ?? { trades: 0, wins: 0, pnl: 0 };
    tk.trades++; if ((t.pnlNet ?? 0) > 0) tk.wins++; tk.pnl += t.pnlNet ?? 0;
    tickerMap.set(t.ticker, tk);

    const rg = regimeMap.get(t.entryRegime) ?? { trades: 0, wins: 0, pnl: 0 };
    rg.trades++; if ((t.pnlNet ?? 0) > 0) rg.wins++; rg.pnl += t.pnlNet ?? 0;
    regimeMap.set(t.entryRegime, rg);
  }

  return {
    strategy: strategy.name,
    timeframe,
    budget,
    trades,
    summary,
    exitBreakdown: [...exitMap.entries()]
      .map(([reason, d]) => ({ reason, count: d.count, totalPnl: d.pnl, avgPnl: d.pnl / d.count }))
      .sort((a, b) => b.count - a.count),
    tickerBreakdown: [...tickerMap.entries()]
      .map(([ticker, d]) => ({ ticker, trades: d.trades, winRate: d.trades > 0 ? d.wins / d.trades : 0, totalPnl: d.pnl }))
      .sort((a, b) => b.totalPnl - a.totalPnl),
    regimeBreakdown: [...regimeMap.entries()]
      .map(([regime, d]) => ({ regime, trades: d.trades, winRate: d.trades > 0 ? d.wins / d.trades : 0, totalPnl: d.pnl }))
      .sort((a, b) => b.totalPnl - a.totalPnl),
  };
}

export async function runMultiStrategyBacktest(params: {
  tickers: string[];
  startDate: Date;
  endDate: Date;
  budget: number;
  timeframes: string[];
  strategies: StrategyConfig[];
  feeRoundTrip: number;
  execution?: MSExecutionOpts;
}): Promise<MSReport> {
  const results: StrategyResult[] = [];
  const exec = params.execution ?? {};

  for (const tf of params.timeframes) {
    console.log(`\nLoading ${tf} candles...`);
    const candleMap = await loadAllCandles(params.tickers, params.startDate, params.endDate, tf);

    for (const strategy of params.strategies) {
      if (!strategy.allowedTimeframes.includes(tf)) continue;

      console.log(`  Running ${strategy.name} on ${tf}...`);
      const allTrades: MSTrade[] = [];
      const budgetPerTicker = params.budget / params.tickers.length;

      for (const ticker of params.tickers) {
        const candles = candleMap.get(ticker);
        if (!candles || candles.length < MIN_CANDLES) continue;

        const trades = simulateTicker(
          ticker, candles, strategy, tf, budgetPerTicker, params.feeRoundTrip, exec,
        );
        console.log(`    ${ticker}: ${trades.length} trades, ${trades.filter(t => (t.pnlNet ?? 0) > 0).length}W/${trades.filter(t => (t.pnlNet ?? 0) <= 0).length}L, PnL $${trades.reduce((s, t) => s + (t.pnlNet ?? 0), 0).toFixed(2)}`);
        allTrades.push(...trades);
      }

      results.push(buildResult(strategy, tf, params.budget, allTrades));
    }
  }

  const comparison: ComparisonRow[] = results.map(r => ({
    strategy: r.strategy,
    timeframe: r.timeframe,
    trades: r.summary.totalTrades,
    winRate: (r.summary.winRate * 100).toFixed(1) + '%',
    pnl: '$' + r.summary.totalPnlNet.toFixed(2),
    pnlPercent: r.summary.totalPnlPercent.toFixed(1) + '%',
    profitFactor: r.summary.profitFactor.toFixed(2),
    avgWin: '+$' + r.summary.avgWinPnl.toFixed(2),
    avgLoss: '-$' + Math.abs(r.summary.avgLossPnl).toFixed(2),
    maxDD: r.summary.maxDrawdownPercent.toFixed(1) + '%',
  }));

  return { results, comparison };
}
