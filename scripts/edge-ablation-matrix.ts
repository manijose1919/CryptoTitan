#!/usr/bin/env node
/**
 * Locked fee-aware edge ablation matrix (research only — does not promote config).
 *
 * Protocol (pre-registered before looking at results):
 *   fills: next-bar open via runBacktest, 0.52% RT taker, 5 bps/side, pessimistic bars
 *   universe: CAD Kraken USD 10 (or locked majors subset)
 *   halves: earlier 45d + recent 45d (OOS = recent half)
 *   promotion bar (not applied here): OOS PF>1.2 AND OOS net>0 AND earlier half PF>=0.9
 *
 * Ablations are one change vs baseline. No regime loosening / ATR floor drop / ticker mining.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-ablation-matrix.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
/** Pre-registered liquidity tier — locked before seeing results (not post-hoc winners). */
const MAJORS4 = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD'];

type Snapshot = {
  MIN_COMPOSITE_SCORE: number;
  MIN_ATR_PERCENT: number;
  TRAILING_ACTIVATE_PERCENT: number;
  TRAILING_GIVEBACK_PERCENT: number;
  STOP_LOSS_ATR_MULT: number;
};

function snap(): Snapshot {
  return {
    MIN_COMPOSITE_SCORE: V2_CONFIG.MIN_COMPOSITE_SCORE,
    MIN_ATR_PERCENT: V2_CONFIG.MIN_ATR_PERCENT,
    TRAILING_ACTIVATE_PERCENT: V2_CONFIG.TRAILING_ACTIVATE_PERCENT,
    TRAILING_GIVEBACK_PERCENT: V2_CONFIG.TRAILING_GIVEBACK_PERCENT,
    STOP_LOSS_ATR_MULT: V2_CONFIG.STOP_LOSS_ATR_MULT,
  };
}

function restore(s: Snapshot): void {
  Object.assign(V2_CONFIG, s);
}

type Ablation = {
  id: string;
  label: string;
  tickers?: string[];
  interval?: string;
  apply: () => void;
};

const ABLATIONS: Ablation[] = [
  {
    id: 'baseline',
    label: 'Current paper config (STRONG_UP, ATR≥1, score≥60, trail@1%)',
    apply: () => {},
  },
  {
    id: 'score_65',
    label: 'Tighter entry: MIN_COMPOSITE_SCORE 65',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 65;
    },
  },
  {
    id: 'atr_1_5',
    label: 'Tighter vol gate: MIN_ATR_PERCENT 1.5',
    apply: () => {
      (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = 1.5;
    },
  },
  {
    id: 'trail_act_2pct',
    label: 'Later trail arm: TRAILING_ACTIVATE_PERCENT 2%',
    apply: () => {
      (V2_CONFIG as { TRAILING_ACTIVATE_PERCENT: number }).TRAILING_ACTIVATE_PERCENT = 0.02;
    },
  },
  {
    id: 'trail_giveback_5pct',
    label: 'Wider trail giveback 5% of peak gain',
    apply: () => {
      (V2_CONFIG as { TRAILING_GIVEBACK_PERCENT: number }).TRAILING_GIVEBACK_PERCENT = 0.05;
    },
  },
  {
    id: 'sl_atr_1_2',
    label: 'Tighter SL: STOP_LOSS_ATR_MULT 1.2',
    apply: () => {
      (V2_CONFIG as { STOP_LOSS_ATR_MULT: number }).STOP_LOSS_ATR_MULT = 1.2;
    },
  },
  {
    id: 'majors4',
    label: 'Locked majors tier: BTC/ETH/SOL/XRP only',
    tickers: MAJORS4,
    apply: () => {},
  },
  {
    id: 'tf_1h',
    label: 'Timeframe 1h (same gates; expect fee drag)',
    interval: '1h',
    apply: () => {},
  },
];

function intervalMinutes(interval: string): number {
  const map: Record<string, number> = { '1h': 60, '4h': 240 };
  const m = map[interval];
  if (!m) throw new Error(`unsupported interval ${interval}`);
  return m;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  const wins = result.trades.filter((t) => (t.pnlNet ?? 0) > 0);
  const losses = result.trades.filter((t) => (t.pnlNet ?? 0) <= 0);
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
    maxDd: Number(s.maxDrawdownUsd.toFixed(2)),
    wins: wins.length,
    losses: losses.length,
  };
}

async function runWindow(opts: {
  label: string;
  days: number;
  end: Date;
  tickers: string[];
  interval: string;
}): Promise<ReturnType<typeof summarize> & { start: string; end: string; elapsedSec: number }> {
  const endDate = opts.end;
  const startDate = new Date(endDate.getTime() - opts.days * 86400000);
  const config: BacktestConfig = {
    startDate,
    endDate,
    tickers: opts.tickers,
    budgetPerTicker: 1000,
    interval: opts.interval,
    intervalMinutes: intervalMinutes(opts.interval),
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    seed: false,
  };
  const t0 = Date.now();
  console.log(`\n>>> ${opts.label} | ${startDate.toISOString().slice(0, 10)}→${endDate.toISOString().slice(0, 10)} | ${opts.interval} | ${opts.tickers.length} tickers`);
  const result = await runBacktest(config);
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  const summary = summarize(result);
  console.log(`    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} avgW=$${summary.avgWin} avgL=$${summary.avgLoss} (${elapsedSec}s)`);
  return {
    ...summary,
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    elapsedSec,
  };
}

function meetsPromotionBar(oos: { pf: number | null; net: number }, earlier: { pf: number | null }): boolean {
  return (oos.pf ?? 0) > 1.2 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const baselineSnap = snap();
  const endRecent = new Date();
  // Align to UTC midnight for stable windows
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);

  const matrix: Array<Record<string, unknown>> = [];

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Fee-aware edge ablation matrix (locked hypotheses) ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`Regimes: ${V2_CONFIG.ALLOWED_REGIMES.join(',')}`);
  console.log(`Fees: ${(V2_CONFIG.FEE_ROUND_TRIP_TAKER * 100).toFixed(2)}% RT + ${(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE * 100).toFixed(2)}%/side`);
  console.log(`Promotion bar: OOS(recent45) PF>1.2 & net>0 & earlier45 PF>=0.9`);

  for (const abl of ABLATIONS) {
    restore(baselineSnap);
    abl.apply();
    const tickers = abl.tickers ?? CAD10;
    const interval = abl.interval ?? '4h';

    const full = await runWindow({
      label: `${abl.id}/full90`,
      days: 90,
      end: endRecent,
      tickers,
      interval,
    });
    const earlier = await runWindow({
      label: `${abl.id}/earlier45`,
      days: 45,
      end: endEarlier,
      tickers,
      interval,
    });
    const oos = await runWindow({
      label: `${abl.id}/oos45`,
      days: 45,
      end: endRecent,
      tickers,
      interval,
    });

    const row = {
      id: abl.id,
      label: abl.label,
      interval,
      tickers: tickers.join(','),
      full90: full,
      earlier45: earlier,
      oos45: oos,
      meetsPromotionBar: meetsPromotionBar(oos, earlier),
    };
    matrix.push(row);
    console.log(`== ${abl.id}: promotionBar=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} | earlier PF=${earlier.pf}`);
  }

  restore(baselineSnap);

  const out = {
    generatedAt: new Date().toISOString(),
    protocol: {
      fills: 'next-bar-open (backtestEngine)',
      barSequence: 'pessimistic',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      regimes: [...V2_CONFIG.ALLOWED_REGIMES],
      promotionBar: 'oos45 PF>1.2 AND oos45 net>0 AND earlier45 PF>=0.9',
      notes: [
        'Research only — does not mutate production config or enable live/ML',
        'No UP-regime / ATR-floor-drop / post-hoc ticker cherry-picks',
        'majors4 list locked before results',
      ],
    },
    matrix,
    anyPromotionPass: matrix.some((r) => r.meetsPromotionBar === true),
  };

  const path = '/opt/cursor/artifacts/edge-ablation-matrix.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  console.log(`Any ablation meets promotion bar: ${out.anyPromotionPass}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
