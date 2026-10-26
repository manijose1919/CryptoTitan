#!/usr/bin/env node
/**
 * Confirm-mode + confirmMomentum ablation under UP+ADX15+MAX2.8 paper stack.
 * Quality-gate variants only — no risk loosening.
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
type ConfirmMode = NonNullable<NonNullable<BacktestConfig['entryFilters']>['confirmMode']>;

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

async function run(
  days: number,
  end: Date,
  label: string,
  confirmMode: ConfirmMode | null,
  confirmMomentum: boolean,
) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const entryFilters: BacktestConfig['entryFilters'] = {
    maxSignalCloseLocation: 0.85,
    minAdx: ADX_THRESHOLDS.TREND_MIN,
    minSignalAtrPercent: 1.5,
    maxSignalAtrPercent: 2.8,
    minVolumeRatio: 0.2,
    confirmMomentum,
  };
  if (confirmMode != null) entryFilters.confirmMode = confirmMode;
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
    entryFilters,
    seed: false,
  };
  console.log(
    `>>> ${label} mode=${confirmMode ?? 'off'} mom=${confirmMomentum} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`,
  );
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function dual(
  id: string,
  end: Date,
  confirmMode: ConfirmMode | null,
  confirmMomentum: boolean,
) {
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await run(90, end45, `${id}/earlier90`, confirmMode, confirmMomentum);
  const oos45 = await run(45, end, `${id}/oos45`, confirmMode, confirmMomentum);
  const earlier60 = await run(60, end60, `${id}/earlier60`, confirmMode, confirmMomentum);
  const oos60 = await run(60, end, `${id}/oos60`, confirmMode, confirmMomentum);
  const pass9045 = meetsBar(oos45, earlier90);
  const pass6060 = meetsBar(oos60, earlier60);
  const tot =
    (earlier90.net || 0) + (oos45.net || 0) + (earlier60.net || 0) + (oos60.net || 0);
  return {
    id,
    confirmMode,
    confirmMomentum,
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
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const variants: { id: string; mode: ConfirmMode | null; mom: boolean }[] = [
    { id: 'paper_bullish_mom', mode: 'bullish_close', mom: true },
    { id: 'bullish_mom_off', mode: 'bullish_close', mom: false },
    { id: 'close_above_mom', mode: 'close_above_signal', mom: true },
    { id: 'bullish_and_above_mom', mode: 'bullish_and_above', mom: true },
    { id: 'confirm_off_mom', mode: null, mom: true },
  ];

  const rows = [];
  for (const v of variants) {
    console.log(`\n=== ${v.id} ===`);
    const row = await dual(v.id, end, v.mode, v.mom);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass} Σnet=$${row.sumNet}`);
  }

  const paper = rows.find((r) => r.id === 'paper_bullish_mom');
  const better = rows.filter(
    (r) => r.id !== 'paper_bullish_mom' && r.dualPass && (r.sumNet ?? 0) > (paper?.sumNet ?? 0),
  );
  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Confirm-mode + confirmMomentum under UP+ADX15+MAX2.8 (quality gates only)',
    stack:
      'STRONG_UP+UP + chase0.85 + ATR1.5-2.8 + ADX15 + no_overnight + conf0.60 + tk4 + vol0.20',
    rows,
    paperDual: paper?.dualPass ?? false,
    betterThanPaper: better.map((r) => r.id),
  };
  const paths = writeResearchArtifact('edge-confirm-adx15-stack-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, paperDual: out.paperDual, betterThanPaper: out.betterThanPaper }, null, 2));
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
