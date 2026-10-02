#!/usr/bin/env node
/**
 * Alternate-TF probe: confirm stack on 1h (research only).
 *
 * 4h confirm stack is OOS-strong but earlier n≤8. Hypothesis: 1h yields
 * earlier n≥10 while keeping OOS PF>1.1 under the same entry stack.
 *
 * Protocol: 90d earlier / 45d OOS, CAD10, STRONG_UP, 1h, 0.52% RT, 5bps,
 * pessimistic. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-confirm-1h-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Ablation = {
  id: string;
  label: string;
  maxAtr: number;
  entryFilters?: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  { id: 'baseline_1h', label: '1h MAX_ATR=8 no filters', maxAtr: 8 },
  {
    id: 'confirm_stack_1h',
    label: '1h MAX2.5 + bullish + chase',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8 },
  },
  {
    id: 'confirm_minatr_1h',
    label: '1h MAX2.5 + bullish + chase + minATR≥1.5',
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
    },
  },
];

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) {
    throw new Error('holdBars<0 invariant failed');
  }
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const prev = V2_CONFIG.MAX_ATR_PERCENT;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = ab.maxAtr;
  const startDate = new Date(end.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate,
    endDate: end,
    tickers: CAD10,
    budgetPerTicker: 1000,
    interval: '1h',
    intervalMinutes: 60,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    entryFilters: ab.entryFilters,
    seed: false,
  };
  console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prev;
  const summary = summarize(result);
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops}`,
  );
  return summary;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Confirm-stack 1h alternate-TF probe (robust 90/45)     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis: '1h confirm stack reaches earlier n≥10 with promotion-bar metrics.',
    protocol: {
      interval: '1h',
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-confirm-1h-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-confirm-1h-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-confirm-1h-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
