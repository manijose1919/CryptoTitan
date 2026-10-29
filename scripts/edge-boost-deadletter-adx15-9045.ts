#!/usr/bin/env node
/**
 * TimeGate BOOST_AMOUNT / BOOSTED_HOURS ablation under locked ADX15 stack.
 * Hypothesis: with MIN_CONFIDENCE=0.60 and confidence=score/100, boost is a dead
 * letter (need score≥60 anyway). Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
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
      maxSignalCloseLocation: 0.85,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      maxSignalAtrPercent: 2.8,
      confirmMomentum: true,
      minVolumeRatio: 0.2,
    },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function dual(
  id: string,
  end: Date,
  boostHours: readonly number[],
  boostAmount: number,
) {
  const prevH = [...TIME_GATE_CONFIG.BOOSTED_HOURS];
  const prevA = TIME_GATE_CONFIG.BOOST_AMOUNT;
  try {
    (TIME_GATE_CONFIG as { BOOSTED_HOURS: readonly number[] }).BOOSTED_HOURS = boostHours;
    (TIME_GATE_CONFIG as { BOOST_AMOUNT: number }).BOOST_AMOUNT = boostAmount;
    (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13];
    (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = [5];
    (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = true;

    const end45 = new Date(end.getTime() - 45 * 86400000);
    const end60 = new Date(end.getTime() - 60 * 86400000);
    const earlier90 = await run(90, end45, `${id}/earlier90`);
    const oos45 = await run(45, end, `${id}/oos45`);
    const earlier60 = await run(60, end60, `${id}/earlier60`);
    const oos60 = await run(60, end, `${id}/oos60`);
    const pass9045 = meetsBar(oos45, earlier90);
    const pass6060 = meetsBar(oos60, earlier60);
    const tot =
      (earlier90.net || 0) + (oos45.net || 0) + (earlier60.net || 0) + (oos60.net || 0);
    return {
      id,
      boostHours: [...boostHours],
      boostAmount,
      split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
      split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
      dualPass: pass9045 && pass6060,
      sumNet: Number(tot.toFixed(2)),
      fingerprint: `${earlier90.trades}/${oos45.trades}/${earlier60.trades}/${oos60.trades}:${earlier90.net}/${oos45.net}/${earlier60.net}/${oos60.net}`,
    };
  } finally {
    (TIME_GATE_CONFIG as { BOOSTED_HOURS: readonly number[] }).BOOSTED_HOURS = prevH;
    (TIME_GATE_CONFIG as { BOOST_AMOUNT: number }).BOOST_AMOUNT = prevA;
  }
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.8;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO = 0.2;
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const variants: { id: string; hours: readonly number[]; amount: number }[] = [
    { id: 'paper_boost5', hours: [12, 14, 17, 21], amount: 5 },
    { id: 'boost0_same_hours', hours: [12, 14, 17, 21], amount: 0 },
    { id: 'boost10_same_hours', hours: [12, 14, 17, 21], amount: 10 },
    { id: 'boost_hours_empty', hours: [], amount: 5 },
  ];

  const rows = [];
  for (const v of variants) {
    console.log(`\n=== ${v.id} ===`);
    const row = await dual(v.id, end, v.hours, v.amount);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass} Σnet=$${row.sumNet} fp=${row.fingerprint}`);
  }

  const paper = rows.find((r) => r.id === 'paper_boost5');
  const identicalToPaper = rows
    .filter((r) => r.id !== 'paper_boost5' && r.fingerprint === paper?.fingerprint)
    .map((r) => r.id);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Confirm TimeGate scoreBoost is dead letter under MIN_CONFIDENCE=0.60',
    note: 'confidence = compositeScore/100; conf≥0.60 requires score≥60, so BOOST_AMOUNT cannot admit 55–59',
    stack:
      'STRONG_UP+UP + confirm + chase0.85 + ATR1.5-2.8 + ADX15 + mom + conf0.60 + tk4 + vol0.20 + TG[13]+Fri',
    rows,
    paperDual: paper?.dualPass ?? false,
    paperSumNet: paper?.sumNet ?? null,
    identicalToPaper,
    deadLetterConfirmed: identicalToPaper.length === variants.length - 1,
  };
  const paths = writeResearchArtifact('edge-boost-deadletter-adx15-9045.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        written: paths,
        deadLetterConfirmed: out.deadLetterConfirmed,
        identicalToPaper: out.identicalToPaper,
        paperSumNet: out.paperSumNet,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
