#!/usr/bin/env node
/**
 * Soften-only confidence neighborhood under locked stack (research only).
 * Funnel shows score/conf as the binding compressor after TimeGate.
 * Ask: does MIN_CONFIDENCE 0.60–0.63 clear earlier n≥10 + PF≥0.9 on 90/45?
 *
 * NOT a promote candidate unless full bar clears — casual risk loosening otherwise.
 *
 * Protocol: 90/45 CAD10 4h fee-aware locked stack.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

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
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      confirmMomentum: true,
    },
    seed: false,
  };
  console.log(`  >>> ${label} conf=${V2_CONFIG.MIN_CONFIDENCE}`);
  const r = await runBacktest(config);
  const out = summarize(r);
  console.log(`      n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;

  const paperConf = V2_CONFIG.MIN_CONFIDENCE;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  const levels = [paperConf, 0.63, 0.62, 0.60];
  const rows = [];
  for (const conf of levels) {
    (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = conf;
    console.log(`\n=== conf=${conf} ===`);
    const earlier90 = await run(90, end45, 'earlier90');
    const oos45 = await run(45, end, 'oos45');
    rows.push({
      minConf: conf,
      earlier90,
      oos45,
      pass9045: meetsBar(oos45, earlier90),
    });
  }
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = paperConf;

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Softening MIN_CONFIDENCE under locked stack — n elasticity only',
    paperConf,
    anyPromote: rows.some((r) => r.pass9045),
    rows,
  };
  writeFileSync('/opt/cursor/artifacts/edge-conf-soften-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-conf-soften-9045.json', JSON.stringify(out, null, 2));
  console.log('\nanyPromote=', out.anyPromote);
  for (const r of rows) {
    console.log(
      `${r.pass9045 ? 'PASS' : 'fail'} conf=${r.minConf} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} net=${r.earlier90.net} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
