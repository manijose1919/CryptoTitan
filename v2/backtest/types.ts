// ============================================
// Phoenix V2 Backtest Types
// ============================================

import type { SignalSnapshot, ExitReason, Regime } from '../pipeline/types.ts';

// --- Configuration ---

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  tickers: string[];
  budgetPerTicker: number;
  interval: string;       // '15m', '1h', etc.
  intervalMinutes: number; // 15, 60, etc.
  maxOpenPositions: number;
  feeRoundTrip: number;   // e.g. 0.0052 for Kraken taker
  slippagePerSide: number;
  // Intra-bar price ordering for exit simulation (default 'pessimistic').
  // 'pessimistic' visits the adverse extreme before the favorable one (SL wins ties);
  // 'optimistic' is the legacy favorable-first ordering, kept for comparison runs.
  barSequence?: 'pessimistic' | 'optimistic';
  /**
   * Optional research filters on the *signal* bar (last closed bar before next-bar entry).
   * Aimed at same-bar stop-outs (holdBars=0) from the 2026-09-30 loss autopsy.
   * Unset = no extra filter (paper-default path).
   */
  entryFilters?: {
    /** Longs: reject if close location (close-low)/(high-low) exceeds this (chase). */
    maxSignalCloseLocation?: number;
    /** Reject if signal-bar range / ATR exceeds this (chaotic bar). */
    maxSignalRangeAtrMult?: number;
    /**
     * If set, wait one confirmation bar after the signal, then enter at the
     * following open (signal → confirm → entry). Research-only lag vs paper.
     * - bullish_close: confirm close > confirm open
     * - close_above_signal: confirm close > signal close
     */
    confirmMode?: 'bullish_close' | 'close_above_signal';
  };
  seed: boolean;
}

// --- Trade Record ---

export interface BacktestTrade {
  id: string;
  ticker: string;
  side: 'long' | 'short';
  entryBar: number;        // bar index in candle array
  entryPrice: number;
  entryTime: number;       // Unix ms
  entrySignals: SignalSnapshot;
  entryRegime: Regime;
  entryConfidence: number;
  compositeScore: number;
  exitBar: number | null;
  exitPrice: number | null;
  exitTime: number | null;
  exitReason: ExitReason | null;
  quantity: number;
  positionSizeUsd: number;
  stopLoss: number;        // initial SL
  takeProfit: number;
  currentStop: number;     // tracks SL tightening
  trailingActivated: boolean;
  peakPrice: number;       // highest price seen since entry (for accurate peak PnL)
  pnlGross: number | null;
  pnlNet: number | null;
  feesPaid: number;
  holdBars: number;        // bars held
  holdDurationMs: number | null;
  atrPercent: number;      // ATR% at entry
}

// --- Aggregated Results ---

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  summary: BacktestSummary;
  signalScores: SignalScoreResult[];
  regimeBreakdown: RegimeBreakdown[];
  tickerBreakdown: TickerBreakdown[];
}

export interface BacktestSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnlNet: number;
  totalPnlPercent: number;
  avgWinPnl: number;
  avgLossPnl: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  avgHoldBars: number;
  avgHoldDurationMs: number;
  bestTrade: BacktestTrade | null;
  worstTrade: BacktestTrade | null;
}

export interface SignalScoreResult {
  signalName: string;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  avgPnlWhenActive: number;
  avgPnlWhenInactive: number;
  edge: number;
  verdict: 'proven' | 'negative' | 'inconclusive';
}

export interface RegimeBreakdown {
  regime: string;
  trades: number;
  winRate: number;
  totalPnl: number;
}

export interface TickerBreakdown {
  ticker: string;
  trades: number;
  winRate: number;
  totalPnl: number;
}
