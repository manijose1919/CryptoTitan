#!/usr/bin/env node
/**
 * UP regime re-probe under the full 2026-10-22 promote stack (research only).
 *
 * Prior: bare allow_UP failed; UP+confirm without ADX cleared then failed ADX parity
 * (2026-10-05). Ask whether UP + full quality stack (confirm+ADX20+chase0.85+
 * conf0.60+vol0.20+tk4+no_overnight) dual-clears fee-aware 90/45 and 60/60.
 *
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
const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.85,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
  minVolumeRatio: 0.2,
};

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
  console.log(`>>> ${label} regimes=${[...V2_CONFIG.ALLOWED_REGIMES]} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(
    `    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf} byRegime=${JSON.stringify(out.byRegime)}`,
  );
  return out;
}

async function dual(id: string, end: Date) {
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await run(90, end45, `${id}/earlier90`);
  const oos45 = await run(45, end, `${id}/oos45`);
  const earlier60 = await run(60, end60, `${id}/earlier60`);
  const oos60 = await run(60, end, `${id}/oos60`);
  const pass9045 = meetsBar(oos45, earlier90);
  const pass6060 = meetsBar(oos60, earlier60);
  return {
    id,
    split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
    split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
    dualPass: pass9045 && pass6060,
  };
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO = 0.2;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const variants: { id: string; regimes: string[] }[] = [
    { id: 'strong_only_paper', regimes: ['STRONG_UP'] },
    { id: 'allow_up_confirm_stack', regimes: ['STRONG_UP', 'UP'] },
  ];

  const rows = [];
  for (const v of variants) {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = v.regimes;
    console.log(`\n=== ${v.id} ===`);
    const row = await dual(v.id, end);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'UP+full promote stack dual-split re-probe after vol/tk4/overnight package',
    stack:
      'confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60 + tk4 + vol0.20',
    signalWeightMode: 'static',
    rows,
    anyDualPass: rows.some((r) => r.dualPass),
    upClears: rows.find((r) => r.id === 'allow_up_confirm_stack')?.dualPass ?? false,
  };
  const paths = writeResearchArtifact('edge-up-promote-stack-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, upClears: out.upClears }, null, 2));
  for (const r of rows) {
    const a = r.split_90_45;
    const b = r.split_60_60;
    console.log(
      `${r.dualPass ? 'DUAL' : '----'} ${r.id} | 90/45 n=${a.earlier.trades}/${a.oos.trades} PF=${a.earlier.pf}/${a.oos.pf} net=$${a.earlier.net}/$${a.oos.net} | 60/60 n=${b.earlier.trades}/${b.oos.trades} PF=${b.earlier.pf}/${b.oos.pf} net=$${b.earlier.net}/$${b.oos.net}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
