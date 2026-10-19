#!/usr/bin/env node
/**
 * maxSignalRangeAtrMult under locked paper stack only (no conf soften).
 * Prior neighborhood used conf0.55; this isolates chaos-bar filter on current gates.
 *
 * Protocol: 90/45 CAD10 4h. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 * Prefer warm DATA_DIR=/tmp/cryptotitan-edge-research for full 90d candles.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const BASE: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function run(days: number, end: Date, label: string, filters: BacktestConfig['entryFilters']) {
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
    entryFilters: { ...filters },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const r = await runBacktest(config);
  const out = summarize(r);
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  const variants: { id: string; filters: BacktestConfig['entryFilters'] }[] = [
    { id: 'paper_live', filters: { ...BASE } },
    { id: 'range_2.5', filters: { ...BASE, maxSignalRangeAtrMult: 2.5 } },
    { id: 'range_2.0', filters: { ...BASE, maxSignalRangeAtrMult: 2.0 } },
    { id: 'range_1.75', filters: { ...BASE, maxSignalRangeAtrMult: 1.75 } },
  ];

  const rows = [];
  for (const v of variants) {
    const earlier90 = await run(90, end45, `${v.id}/earlier90`, v.filters);
    const oos45 = await run(45, end, `${v.id}/oos45`, v.filters);
    rows.push({
      id: v.id,
      earlier90,
      oos45,
      pass9045: meetsBar(oos45, earlier90),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Isolate maxSignalRangeAtrMult under locked stack (conf stays 0.65)',
    stack: 'STRONG_UP + confirm + chase0.8 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum',
    signalWeightMode: 'static',
    rows,
    anyPromote: rows.some((r) => r.pass9045),
  };
  writeFileSync('/opt/cursor/artifacts/edge-range-atr-locked-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-range-atr-locked-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.pass9045 ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
