#!/usr/bin/env node
/**
 * Fee-aware loss-structure autopsy (research only).
 * Goal: explain avgLoss ≈ 2× avgWin under paper exit-parity protocol.
 *
 * Protocol matches prior CAD10 TREND ablations:
 *   next-bar open, 0.52% RT, 5bps/side, pessimistic, STRONG_UP, 4h
 *   windows: earlier45 + oos45 + full90
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-loss-structure.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestTrade } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function tradeMetrics(t: BacktestTrade) {
  const entry = t.entryPrice;
  const exit = t.exitPrice ?? entry;
  const pnlNet = t.pnlNet ?? 0;
  const stopDistPct = Math.abs(entry - t.stopLoss) / entry;
  const movePct = t.side === 'short' ? (entry - exit) / entry : (exit - entry) / entry;
  const peakPct = t.side === 'short'
    ? (entry - t.peakPrice) / entry
    : (t.peakPrice - entry) / entry;
  const rMultiple = stopDistPct > 0 ? movePct / stopDistPct : null;
  const rNet = stopDistPct > 0 ? (pnlNet / t.positionSizeUsd) / stopDistPct : null;
  return {
    id: t.id,
    ticker: t.ticker,
    reason: t.exitReason,
    pnlNet: Number(pnlNet.toFixed(2)),
    fees: Number((t.feesPaid ?? 0).toFixed(2)),
    size: Number(t.positionSizeUsd.toFixed(2)),
    atrPercent: Number(t.atrPercent.toFixed(3)),
    stopDistPct: Number((stopDistPct * 100).toFixed(3)),
    movePct: Number((movePct * 100).toFixed(3)),
    peakPct: Number((peakPct * 100).toFixed(3)),
    holdBars: t.holdBars,
    trailingActivated: t.trailingActivated,
    score: Number(t.compositeScore.toFixed(1)),
    conf: Number(t.entryConfidence.toFixed(3)),
    rMultiple: rMultiple == null ? null : Number(rMultiple.toFixed(3)),
    rNet: rNet == null ? null : Number(rNet.toFixed(3)),
    feeShareOfAbsPnl: pnlNet === 0 ? null : Number((Math.abs(t.feesPaid ?? 0) / Math.max(Math.abs(pnlNet), 1e-9)).toFixed(3)),
  };
}

function bucket<T extends { atrPercent: number }>(trades: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const t of trades) {
    const k = key(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()].map(([k, arr]) => {
    const pnls = arr.map((t) => (t as unknown as { pnlNet: number }).pnlNet);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p <= 0);
    return {
      key: k,
      n: arr.length,
      wr: Number((wins.length / arr.length).toFixed(3)),
      net: Number(pnls.reduce((a, b) => a + b, 0).toFixed(2)),
      avgWin: Number(mean(wins).toFixed(2)),
      avgLoss: Number(mean(losses).toFixed(2)),
      medHold: median(arr.map((t) => (t as unknown as { holdBars: number }).holdBars)),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function analyze(label: string, trades: BacktestTrade[]) {
  const rows = trades.map(tradeMetrics);
  const wins = rows.filter((t) => t.pnlNet > 0);
  const losses = rows.filter((t) => t.pnlNet <= 0);
  const byReason = bucket(rows, (t) => String(t.reason));
  const byAtr = bucket(rows, (t) => {
    if (t.atrPercent < 1.5) return 'atr_1_1.5';
    if (t.atrPercent < 2.5) return 'atr_1.5_2.5';
    if (t.atrPercent < 4) return 'atr_2.5_4';
    return 'atr_4plus';
  });
  const lossByReason = bucket(losses, (t) => String(t.reason));
  const stopLosses = losses.filter((t) => t.reason === 'stop_loss');
  const trailLosses = losses.filter((t) => t.reason === 'trailing');
  const timeKills = rows.filter((t) => t.reason === 'time_kill');

  const summary = {
    label,
    n: rows.length,
    wr: Number((wins.length / Math.max(rows.length, 1)).toFixed(4)),
    net: Number(rows.reduce((a, b) => a + b.pnlNet, 0).toFixed(2)),
    avgWin: Number(mean(wins.map((t) => t.pnlNet)).toFixed(2)),
    avgLoss: Number(mean(losses.map((t) => t.pnlNet)).toFixed(2)),
    winLossRatio: losses.length
      ? Number((Math.abs(mean(wins.map((t) => t.pnlNet))) / Math.abs(mean(losses.map((t) => t.pnlNet)))).toFixed(3))
      : null,
    avgRWin: Number(mean(wins.map((t) => t.rMultiple ?? 0)).toFixed(3)),
    avgRLoss: Number(mean(losses.map((t) => t.rMultiple ?? 0)).toFixed(3)),
    medStopDistPct: Number(median(rows.map((t) => t.stopDistPct)).toFixed(3)),
    medPeakPctWins: Number(median(wins.map((t) => t.peakPct)).toFixed(3)),
    medPeakPctLosses: Number(median(losses.map((t) => t.peakPct)).toFixed(3)),
    pctLossesNeverTrailed: Number((losses.filter((t) => !t.trailingActivated).length / Math.max(losses.length, 1)).toFixed(3)),
    stopLoss: {
      n: stopLosses.length,
      avgPnl: Number(mean(stopLosses.map((t) => t.pnlNet)).toFixed(2)),
      avgR: Number(mean(stopLosses.map((t) => t.rMultiple ?? 0)).toFixed(3)),
      avgStopDistPct: Number(mean(stopLosses.map((t) => t.stopDistPct)).toFixed(3)),
      avgFeeShare: Number(mean(stopLosses.map((t) => t.feeShareOfAbsPnl ?? 0)).toFixed(3)),
    },
    trailingLoss: {
      n: trailLosses.length,
      avgPnl: Number(mean(trailLosses.map((t) => t.pnlNet)).toFixed(2)),
      avgPeakPct: Number(mean(trailLosses.map((t) => t.peakPct)).toFixed(3)),
      avgMovePct: Number(mean(trailLosses.map((t) => t.movePct)).toFixed(3)),
    },
    timeKill: {
      n: timeKills.length,
      avgPnl: Number(mean(timeKills.map((t) => t.pnlNet)).toFixed(2)),
      winRate: Number((timeKills.filter((t) => t.pnlNet > 0).length / Math.max(timeKills.length, 1)).toFixed(3)),
    },
    byReason,
    byAtr,
    lossByReason,
    // worst 8 losses for inspection
    worstLosses: [...losses].sort((a, b) => a.pnlNet - b.pnlNet).slice(0, 8),
  };

  console.log(`\n== ${label} ==`);
  console.log(`n=${summary.n} WR=${(summary.wr * 100).toFixed(1)}% net=$${summary.net} avgW=$${summary.avgWin} avgL=$${summary.avgLoss} W/L=${summary.winLossRatio}`);
  console.log(`avgR win/loss=${summary.avgRWin}/${summary.avgRLoss} medStop%=${summary.medStopDistPct} lossesNeverTrailed=${summary.pctLossesNeverTrailed}`);
  console.log(`stop_loss n=${summary.stopLoss.n} avg=$${summary.stopLoss.avgPnl} avgR=${summary.stopLoss.avgR} stop%=${summary.stopLoss.avgStopDistPct} feeShare=${summary.stopLoss.avgFeeShare}`);
  console.log(`trailing_loss n=${summary.trailingLoss.n} avg=$${summary.trailingLoss.avgPnl} peak%=${summary.trailingLoss.avgPeakPct} exitMove%=${summary.trailingLoss.avgMovePct}`);
  console.log(`time_kill n=${summary.timeKill.n} avg=$${summary.timeKill.avgPnl} WR=${summary.timeKill.winRate}`);
  for (const r of byReason) {
    console.log(`  reason ${r.key}: n=${r.n} WR=${(r.wr * 100).toFixed(0)}% net=$${r.net} avgW=$${r.avgWin} avgL=$${r.avgLoss}`);
  }
  return summary;
}

async function runWindow(label: string, days: number, end: Date) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate,
    endDate: end,
    tickers: CAD10,
    budgetPerTicker: 1000,
    interval: '4h',
    intervalMinutes: 240,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    seed: false,
  };
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  return analyze(label, result.trades);
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Loss-structure autopsy (fee-aware, CAD10, parity)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const earlier = await runWindow('earlier45', 45, endEarlier);
  const oos = await runWindow('oos45', 45, endRecent);
  const full = await runWindow('full90', 90, endRecent);

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis: 'avgLoss≈2×avgWin is driven by stop_loss R≈-1 plus fees, not by trailing giveback alone.',
    protocol: {
      fills: 'next-bar-open + STRATEGY_EXIT_CONFIGS.TREND',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      regimes: [...V2_CONFIG.ALLOWED_REGIMES],
      tickers: CAD10,
    },
    earlier45: earlier,
    oos45: oos,
    full90: full,
  };

  const path = '/opt/cursor/artifacts/edge-loss-structure.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
