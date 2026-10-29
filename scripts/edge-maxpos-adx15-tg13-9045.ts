#!/usr/bin/env node
/**
 * MAX_OPEN_POSITIONS neighborhood under locked UP+ADX15+MAX2.8+TG[13] stack.
 * Paper uses 3; test 2/3/4 for fee-aware dual-split (path/correlation).
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import {
  V2_CONFIG,
  MOMENTUM_CONFIG,
  ADX_THRESHOLDS,
  STRATEGY_EXIT_CONFIGS,
} from '../v2/engine/config.ts';
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

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

function pfOk(pf: number | null, min: number): boolean {
  return pf == null ? true : pf >= min;
}

function meetsBar(
  oos: { pf: number | null; net: number; trades: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return oos.trades > 0 && pfOk(oos.pf, 1.1) && oos.net > 0 && pfOk(earlier.pf, 0.9) && earlier.trades >= 10;
}

async function run(days: number, end: Date, label: string, maxOpen: number) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate,
    endDate: end,
    tickers: CAD10,
    budgetPerTicker: 1000,
    interval: '4h',
    intervalMinutes: 240,
    maxOpenPositions: maxOpen,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.85,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      maxSignalAtrPercent: 2.8,
      confirmMomentum: true,
      minVolumeRatio: 0.2,
    },
    seed: false,
  };
  console.log(`>>> ${label} maxOpen=${maxOpen} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function dual(id: string, end: Date, maxOpen: number) {
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await run(90, end45, `${id}/earlier90`, maxOpen);
  const oos45 = await run(45, end, `${id}/oos45`, maxOpen);
  const earlier60 = await run(60, end60, `${id}/earlier60`, maxOpen);
  const oos60 = await run(60, end, `${id}/oos60`, maxOpen);
  const pass9045 = meetsBar(oos45, earlier90);
  const pass6060 = meetsBar(oos60, earlier60);
  const tot =
    (earlier90.net || 0) + (oos45.net || 0) + (earlier60.net || 0) + (oos60.net || 0);
  return {
    id,
    maxOpen,
    split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
    split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
    dualPass: pass9045 && pass6060,
    sumNet: Number(tot.toFixed(2)),
  };
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.8;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO = 0.2;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13];
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = [5];
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = true;
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const variants = [
    { id: 'max_2', maxOpen: 2 },
    { id: 'paper_3', maxOpen: 3 },
    { id: 'max_4', maxOpen: 4 },
    { id: 'max_5', maxOpen: 5 },
  ];

  const rows = [];
  for (const v of variants) {
    console.log(`\n=== ${v.id} ===`);
    const row = await dual(v.id, end, v.maxOpen);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass} Σnet=$${row.sumNet}`);
  }

  const paper = rows.find((r) => r.id === 'paper_3');
  const better = rows.filter(
    (r) => r.id !== 'paper_3' && r.dualPass && (r.sumNet ?? 0) > (paper?.sumNet ?? 0),
  );
  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'MAX_OPEN_POSITIONS neighborhood under TG[13] locked stack',
    stack:
      'STRONG_UP+UP + confirm + chase0.85 + ATR1.5-2.8 + ADX15 + mom + conf0.60 + tk4 + vol0.20 + TG[13]+Fri',
    rows,
    paperDual: paper?.dualPass ?? false,
    paperSumNet: paper?.sumNet ?? null,
    betterThanPaper: better.map((r) => r.id),
  };
  const paths = writeResearchArtifact('edge-maxpos-adx15-tg13-9045.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        written: paths,
        paperDual: out.paperDual,
        paperSumNet: out.paperSumNet,
        betterThanPaper: out.betterThanPaper,
      },
      null,
      2,
    ),
  );
  for (const r of rows) {
    const a = r.split_90_45;
    const b = r.split_60_60;
    console.log(
      `${r.dualPass ? 'DUAL' : '----'} ${r.id} Σnet=$${r.sumNet} | 90/45 n=${a.earlier.trades}/${a.oos.trades} PF=${a.earlier.pf}/${a.oos.pf} | 60/60 n=${b.earlier.trades}/${b.oos.trades} PF=${b.earlier.pf}/${b.oos.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
