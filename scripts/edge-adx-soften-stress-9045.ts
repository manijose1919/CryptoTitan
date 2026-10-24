#!/usr/bin/env node
/**
 * Longer-window stress for ADX floor soften under UP+full promote stack.
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import {
  V2_CONFIG,
  MOMENTUM_CONFIG,
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
  const byRegime: Record<string, { n: number; net: number }> = {};
  for (const t of result.trades) {
    const k = String(t.entryRegime);
    if (!byRegime[k]) byRegime[k] = { n: 0, net: 0 };
    byRegime[k].n++;
    byRegime[k].net += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byRegime)) v.net = Number(v.net.toFixed(2));
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    byRegime,
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

async function run(days: number, end: Date, label: string, minAdx: number) {
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
      minAdx,
      minSignalAtrPercent: 1.5,
      maxSignalAtrPercent: 2.8,
      confirmMomentum: true,
      minVolumeRatio: 0.2,
    },
    seed: false,
  };
  console.log(
    `>>> ${label} minAdx=${minAdx} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`,
  );
  const out = summarize(await runBacktest(config));
  console.log(
    `    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf} byRegime=${JSON.stringify(out.byRegime)}`,
  );
  return out;
}

async function stress(id: string, end: Date, minAdx: number) {
  const splits = [
    { id: '90_45', earlierDays: 90, oosDays: 45 },
    { id: '60_60', earlierDays: 60, oosDays: 60 },
    { id: '120_60', earlierDays: 120, oosDays: 60 },
    { id: '150_75', earlierDays: 150, oosDays: 75 },
  ];
  const rows = [];
  for (const sp of splits) {
    const endEarlier = new Date(end.getTime() - sp.oosDays * 86400000);
    const earlier = await run(sp.earlierDays, endEarlier, `${id}/${sp.id}/earlier`, minAdx);
    const oos = await run(sp.oosDays, end, `${id}/${sp.id}/oos`, minAdx);
    const pass = meetsBar(oos, earlier);
    rows.push({ id: sp.id, earlier, oos, pass });
    console.log(`  ${id}/${sp.id} pass=${pass}`);
  }
  return { id, minAdx, rows, allPass: rows.every((r) => r.pass) };
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

  const variants = [
    { id: 'paper_adx20', minAdx: 20 },
    { id: 'adx18', minAdx: 18 },
    { id: 'adx15', minAdx: 15 },
  ];

  const results = [];
  for (const v of variants) {
    console.log(`\n=== ${v.id} ===`);
    results.push(await stress(v.id, end, v.minAdx));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Longer-window stress for ADX soften under UP+full stack (MAX_ATR 2.8)',
    stack:
      'STRONG_UP+UP + confirm + chase0.85 + ATR1.5-2.8 + confirmMomentum + no_overnight + conf0.60 + tk4 + vol0.20',
    results,
    paperAllPass: results.find((r) => r.id === 'paper_adx20')?.allPass ?? false,
    adx15AllPass: results.find((r) => r.id === 'adx15')?.allPass ?? false,
    adx18AllPass: results.find((r) => r.id === 'adx18')?.allPass ?? false,
  };
  const paths = writeResearchArtifact('edge-adx-soften-stress-9045.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        written: paths,
        paperAllPass: out.paperAllPass,
        adx18AllPass: out.adx18AllPass,
        adx15AllPass: out.adx15AllPass,
      },
      null,
      2,
    ),
  );
  for (const res of results) {
    console.log(`\n# ${res.id} allPass=${res.allPass}`);
    for (const r of res.rows) {
      const upOos = r.oos.byRegime?.UP;
      console.log(
        `${r.pass ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier.trades} PF=${r.earlier.pf} net=$${r.earlier.net} | oos n=${r.oos.trades} PF=${r.oos.pf} net=$${r.oos.net} | oos UP=${JSON.stringify(upOos)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
