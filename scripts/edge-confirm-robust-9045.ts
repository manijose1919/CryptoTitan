#!/usr/bin/env node
/**
 * Robust 90/45 stress for confirm-bar stacks (research only).
 *
 * Prior cycle: MAX_ATR=2.5 + bullish_close + chase cleared 45/45 but failed
 * 90d-earlier / 45d-OOS (earlier PF 0.456). Goal: find a pre-registered
 * tightening that clears 90/45 with earlier n≥10 (prefer ≥15) without
 * destroying OOS PF>1.1 & net>0.
 *
 * Protocol: next-bar / T+2 confirm, 0.52% RT, 5bps, pessimistic, CAD10,
 * STRONG_UP, 4h. Promotion: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-confirm-robust-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult, BacktestTrade } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Ablation = {
  id: string;
  label: string;
  maxAtr?: number;
  entryFilters?: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  { id: 'baseline', label: 'MAX_ATR=8, no entryFilters' },
  {
    id: 'fragile_pass',
    label: 'Prior fragile: MAX2.5 + bullish + chase≤0.80',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8 },
  },
  {
    id: 'strong_confirm',
    label: 'MAX2.5 + bullish_and_above + chase',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_and_above', maxSignalCloseLocation: 0.8 },
  },
  {
    id: 'min_atr_1_5',
    label: 'MAX2.5 + bullish + chase + minATR%≥1.5',
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
    },
  },
  {
    id: 'atr_band_1_5_2_5',
    label: 'bullish + chase + atr% band [1.5, 2.5] (no global max mutate)',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
      maxSignalAtrPercent: 2.5,
    },
  },
  {
    id: 'maxatr_3_confirm_chase',
    label: 'MAX3.0 + bullish + chase (more earlier trades)',
    maxAtr: 3.0,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8 },
  },
  {
    id: 'strong_min_atr',
    label: 'MAX2.5 + bullish_and_above + chase + minATR%≥1.5',
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_and_above',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
    },
  },
];

function summarize(result: BacktestResult) {
  const s = result.summary;
  const zeroHoldStops = result.trades.filter(
    (t) => t.exitReason === 'stop_loss' && t.holdBars === 0,
  ).length;
  const negativeHold = result.trades.filter((t) => t.holdBars < 0).length;
  if (negativeHold > 0) {
    throw new Error(`Invariant violated: ${negativeHold} trades with holdBars<0`);
  }
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
    zeroHoldStops,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

function autopsyTrades(trades: BacktestTrade[]) {
  const rows = trades.map((t) => ({
    ticker: t.ticker,
    reason: t.exitReason,
    pnl: Number((t.pnlNet ?? 0).toFixed(2)),
    atrPercent: Number(t.atrPercent.toFixed(3)),
    holdBars: t.holdBars,
    peakPct: Number((((t.peakPrice - t.entryPrice) / t.entryPrice) * 100).toFixed(3)),
    score: Number(t.compositeScore.toFixed(1)),
    trailed: t.trailingActivated,
  }));
  const byReason: Record<string, { n: number; net: number }> = {};
  for (const r of rows) {
    const k = String(r.reason);
    if (!byReason[k]) byReason[k] = { n: 0, net: 0 };
    byReason[k].n++;
    byReason[k].net += r.pnl;
  }
  return { n: rows.length, byReason, trades: rows };
}

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const prevMax = V2_CONFIG.MAX_ATR_PERCENT;
  if (ab.maxAtr != null) {
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = ab.maxAtr;
  }
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
    entryFilters: ab.entryFilters,
    seed: false,
  };
  console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prevMax;
  const summary = summarize(result);
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zeroHoldSL=${summary.zeroHoldStops}`,
  );
  return { summary, trades: result.trades };
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Confirm-bar robust 90/45 ablations (fee-aware, CAD10)  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Autopsy prior fragile candidate on earlier90
  const fragile = ABLATIONS.find((a) => a.id === 'fragile_pass')!;
  const fragileEarlier = await runWindow('autopsy/fragile_earlier90', 90, endEarlier90, fragile);
  const fragileAutopsy = autopsyTrades(fragileEarlier.trades);
  console.log('Autopsy earlier90 byReason:', JSON.stringify(fragileAutopsy.byReason));

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier90: earlier.summary,
      oos45: oos.summary,
      meetsPromotionBar: meetsBar(oos.summary, earlier.summary),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.summary.pf} net=$${oos.summary.net} n=${oos.summary.trades} | earlier PF=${earlier.summary.pf} n=${earlier.summary.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Stronger confirm and/or ATR band filters can repair 90d-earlier PF without killing OOS on the confirm+chase stack.',
    protocol: {
      windows: '90d earlier ending 45d ago + 45d OOS to today',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    },
    fragileEarlier90Autopsy: fragileAutopsy,
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  const path = '/opt/cursor/artifacts/edge-confirm-robust-9045.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-confirm-robust-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path} anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
