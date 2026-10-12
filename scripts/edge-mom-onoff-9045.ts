#!/usr/bin/env node
/**
 * MOMENTUM on/off under locked stack + scan-parity (research).
 * After MOMENTUM required scan PASS, re-check whether MOMENTUM still helps
 * OOS without hurting earlier (prior result predates scan-parity fix).
 *
 * Protocol: 90/45 CAD10 4h fee-aware pessimistic. Bar: OOS PF>1.1 & net>0
 * & earlier PF≥0.9 & earlier n≥10.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const momN = result.trades.filter((t) => t.id.endsWith('M')).length;
  return {
    trades: s.totalTrades,
    momTrades: momN,
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

async function run(days: number, end: Date, label: string) {
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
    entryFilters: { ...FILTERS },
    seed: false,
  };
  console.log(`  >>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const r = await runBacktest(config);
  const out = summarize(r);
  console.log(`      n=${out.trades} mom=${out.momTrades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const rows = [];

  for (const momOn of [true, false]) {
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = momOn;
    const id = momOn ? 'mom_on' : 'mom_off';
    console.log(`\n=== ${id} ===`);
    const earlier90 = await run(90, end45, 'earlier90');
    const oos45 = await run(45, end, 'oos45');
    rows.push({
      id,
      earlier90,
      oos45,
      pass9045: meetsBar(oos45, earlier90),
    });
  }

  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'MOMENTUM on/off under locked stack after scan-parity fix',
    anyPromote: rows.some((r) => r.pass9045),
    rows,
  };
  writeFileSync('/opt/cursor/artifacts/edge-mom-onoff-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-mom-onoff-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
