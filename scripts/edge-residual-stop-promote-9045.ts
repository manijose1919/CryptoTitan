#!/usr/bin/env node
/**
 * Residual stop_loss probe under full promote stack incl. vol≥0.20 + tk4.
 * Ask: (1) calendar-rolled dual-split still clears? (2) do ETH/LINK stops share
 * a gateable feature (bb%B / ATR / conf / SR) without starving n?
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
import type { BacktestConfig, BacktestResult, BacktestTrade } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

function baseFilters(extra: BacktestConfig['entryFilters'] = {}): BacktestConfig['entryFilters'] {
  return {
    confirmMode: 'bullish_close',
    maxSignalCloseLocation: 0.85,
    minAdx: ADX_THRESHOLDS.TREND_MIN,
    minSignalAtrPercent: 1.5,
    confirmMomentum: true,
    minVolumeRatio: 0.2,
    ...extra,
  };
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const byReason: Record<string, { n: number; net: number }> = {};
  for (const t of result.trades) {
    const k = String(t.exitReason);
    if (!byReason[k]) byReason[k] = { n: 0, net: 0 };
    byReason[k].n++;
    byReason[k].net += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byReason)) v.net = Number(v.net.toFixed(2));
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    byReason,
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

function stopRow(t: BacktestTrade) {
  const s = (t.entrySignals ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof s[k] === 'number' ? Number((s[k] as number).toFixed(4)) : null);
  return {
    ticker: t.ticker,
    entryTime: t.entryTime,
    entryHourUtc: new Date(t.entryTime).getUTCHours(),
    holdBars: t.holdBars,
    pnlNet: t.pnlNet != null ? Number(t.pnlNet.toFixed(2)) : null,
    confidence: t.entryConfidence,
    score: t.compositeScore,
    atrPercent: t.atrPercent != null ? Number(t.atrPercent.toFixed(3)) : null,
    volume_ratio: n('volume_ratio'),
    bb_percent_b: n('bb_percent_b'),
    rsi: n('rsi'),
    sr_channel_position: n('sr_channel_position'),
    tc_value: n('tc_value'),
    td_score: n('td_score'),
  };
}

async function run(
  days: number,
  end: Date,
  label: string,
  filters: BacktestConfig['entryFilters'],
  exitApply?: () => void,
) {
  const exitBase = {
    ...STRATEGY_EXIT_CONFIGS.TREND,
    timeKillBarsByTf: STRATEGY_EXIT_CONFIGS.TREND.timeKillBarsByTf
      ? { ...STRATEGY_EXIT_CONFIGS.TREND.timeKillBarsByTf }
      : undefined,
  };
  try {
    if (exitApply) exitApply();
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
    const result = await runBacktest(config);
    const summary = summarize(result);
    const stops = result.trades.filter((t) => t.exitReason === 'stop_loss').map(stopRow);
    console.log(
      `    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf} stops=${stops.length}`,
    );
    return { summary, stops, trades: result.trades };
  } finally {
    Object.assign(STRATEGY_EXIT_CONFIGS.TREND, exitBase);
  }
}

async function dual(
  id: string,
  end: Date,
  filters: BacktestConfig['entryFilters'],
  exitApply?: () => void,
) {
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await run(90, end45, `${id}/earlier90`, filters, exitApply);
  const oos45 = await run(45, end, `${id}/oos45`, filters, exitApply);
  const earlier60 = await run(60, end60, `${id}/earlier60`, filters, exitApply);
  const oos60 = await run(60, end, `${id}/oos60`, filters, exitApply);
  const pass9045 = meetsBar(oos45.summary, earlier90.summary);
  const pass6060 = meetsBar(oos60.summary, earlier60.summary);
  return {
    id,
    split_90_45: {
      earlier: earlier90.summary,
      oos: oos45.summary,
      pass: pass9045,
      earlierStops: earlier90.stops,
      oosStops: oos45.stops,
    },
    split_60_60: {
      earlier: earlier60.summary,
      oos: oos60.summary,
      pass: pass6060,
      earlierStops: earlier60.stops,
      oosStops: oos60.stops,
    },
    dualPass: pass9045 && pass6060,
  };
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
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

  const variants: {
    id: string;
    filters?: BacktestConfig['entryFilters'];
    exitApply?: () => void;
  }[] = [
    { id: 'paper_vol020' },
    {
      id: 'max_bb_085',
      filters: baseFilters(),
      // reject extended BB entries via post-filter: use maxSignalRange isn't BB.
      // Probe via research-only: we approximate with higher conf (already have) —
      // instead use maxSignalAtrPercent 2.2 (paper max scanner 2.5).
    },
    {
      id: 'max_atr_signal_22',
      filters: baseFilters({ maxSignalAtrPercent: 2.2 }),
    },
    {
      id: 'sl_atr_12',
      exitApply: () => {
        STRATEGY_EXIT_CONFIGS.TREND.slAtrMult = 1.2;
      },
    },
    {
      id: 'trail_gb_02',
      exitApply: () => {
        STRATEGY_EXIT_CONFIGS.TREND.trailGivebackPercent = 0.02;
      },
    },
  ];

  // Fix max_bb stub — use bb via confidence already; replace with chase tighten
  variants[1] = {
    id: 'chase_080',
    filters: baseFilters({ maxSignalCloseLocation: 0.8 }),
  };

  const rows = [];
  for (const v of variants) {
    const filters = v.filters ?? baseFilters();
    console.log(`\n=== ${v.id} ===`);
    const row = await dual(v.id, end, filters, v.exitApply);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass}`);
  }

  // 150d stop dump under paper_vol020
  const last150 = await run(150, end, 'last150/paper_vol020', baseFilters());

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Residual stop probe + dual-split refresh under vol≥0.20 promote stack',
    stack:
      'STRONG_UP + confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60 + tk4 + vol0.20',
    rows,
    last150: {
      summary: last150.summary,
      stops: last150.stops,
    },
    anyDualPass: rows.some((r) => r.dualPass),
    paperStillDual: rows.find((r) => r.id === 'paper_vol020')?.dualPass ?? false,
  };
  const paths = writeResearchArtifact('edge-residual-stop-promote-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, paperStillDual: out.paperStillDual }, null, 2));
  for (const r of rows) {
    const a = r.split_90_45;
    const b = r.split_60_60;
    console.log(
      `${r.dualPass ? 'DUAL' : '----'} ${r.id} | 90/45 n=${a.earlier.trades}/${a.oos.trades} PF=${a.earlier.pf}/${a.oos.pf} net=$${a.earlier.net}/$${a.oos.net} | 60/60 n=${b.earlier.trades}/${b.oos.trades} PF=${b.earlier.pf}/${b.oos.pf} net=$${b.earlier.net}/$${b.oos.net}`,
    );
  }
  console.log('last150 stops', JSON.stringify(last150.stops, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
