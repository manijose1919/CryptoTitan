#!/usr/bin/env node
/**
 * Tighten-only confidence/score probes under locked stack + MOMENTUM scan parity.
 * Hypothesis: earlier90 BNB stop (conf≈0.653) is a low-conf drag; raising MIN_CONFIDENCE
 * may lift earlier PF without casual risk loosening (gates get stricter).
 *
 * Protocol: 90/45 (+60/60 if 90/45 passes). CAD10 4h fee-aware pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
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

type Snap = { minScore: number; minConf: number };
function snap(): Snap {
  return { minScore: V2_CONFIG.MIN_COMPOSITE_SCORE, minConf: V2_CONFIG.MIN_CONFIDENCE };
}
function restore(s: Snap): void {
  (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = s.minScore;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = s.minConf;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const closed = result.trades.filter((t) => t.pnlNet != null);
  const byExit: Record<string, { n: number; pnl: number }> = {};
  for (const t of closed) {
    const k = t.exitReason ?? '?';
    if (!byExit[k]) byExit[k] = { n: 0, pnl: 0 };
    byExit[k].n++;
    byExit[k].pnl += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byExit)) v.pnl = Number(v.pnl.toFixed(2));
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    byExit,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function runWindow(label: string, days: number, end: Date) {
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
  console.log(`      n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

type Ablation = { id: string; apply: () => void };

const ABLATIONS: Ablation[] = [
  { id: 'paper_conf065_score60', apply: () => {} },
  {
    id: 'conf068',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.68;
    },
  },
  {
    id: 'conf070',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.7;
    },
  },
  {
    id: 'conf072',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.72;
    },
  },
  {
    id: 'score68_conf068',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 68;
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.68;
    },
  },
  {
    id: 'score70_conf070',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 70;
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.7;
    },
  },
];

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const base = snap();
  const rows = [];

  for (const ab of ABLATIONS) {
    restore(base);
    ab.apply();
    console.log(`\n=== ${ab.id} (conf=${V2_CONFIG.MIN_CONFIDENCE} score=${V2_CONFIG.MIN_COMPOSITE_SCORE}) ===`);
    const earlier90 = await runWindow('earlier90', 90, end45);
    const oos45 = await runWindow('oos45', 45, end);
    const pass9045 = meetsBar(oos45, earlier90);
    let earlier60 = null;
    let oos60 = null;
    let pass6060 = false;
    if (pass9045) {
      earlier60 = await runWindow('earlier60', 60, end60);
      oos60 = await runWindow('oos60', 60, end);
      pass6060 = meetsBar(oos60, earlier60);
    }
    rows.push({
      id: ab.id,
      minConf: V2_CONFIG.MIN_CONFIDENCE,
      minScore: V2_CONFIG.MIN_COMPOSITE_SCORE,
      earlier90,
      oos45,
      pass9045,
      earlier60,
      oos60,
      pass6060,
    });
    console.log(`  => 90/45 ${pass9045 ? 'PASS' : 'fail'} | earlier PF=${earlier90.pf} n=${earlier90.trades} | oos PF=${oos45.pf} n=${oos45.trades}`);
  }

  restore(base);
  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Tighten-only conf/score under locked stack + MOMENTUM scan parity',
    stack: 'STRONG_UP + confirm + chase0.8 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum',
    anyPromote: rows.some((r) => r.pass9045 && r.pass6060),
    rows,
  };
  writeFileSync('/opt/cursor/artifacts/edge-conf-tighten-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-conf-tighten-9045.json', JSON.stringify(out, null, 2));
  console.log('\nanyPromote=', out.anyPromote);
  for (const r of rows) {
    console.log(
      `${r.pass9045 ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} net=${r.earlier90.net} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
