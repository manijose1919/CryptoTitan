#!/usr/bin/env node
/**
 * UP + confirm-stack ablations on robust 90/45 (research only).
 *
 * Context: paper soak is dark — all CAD10 HTF regimes are UP, none STRONG_UP.
 * Prior allow_UP alone failed (earlier PF 0.23). Confirm+MAX_ATR+chase is
 * OOS-strong on STRONG_UP but earlier-starved (n≤8). Hypothesis: allowing UP
 * *only when paired with the confirm quality stack* raises earlier n≥10 and
 * can clear the bar without repeating bare allow_UP failure.
 *
 * Protocol: 90d earlier / 45d OOS, CAD10, 4h, 0.52% RT, 5bps, pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-up-confirm-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Snap = { regimes: readonly string[]; maxAtr: number };

function snap(): Snap {
  return { regimes: [...V2_CONFIG.ALLOWED_REGIMES], maxAtr: V2_CONFIG.MAX_ATR_PERCENT };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) {
    throw new Error('holdBars<0 invariant failed');
  }
  const byRegime: Record<string, number> = {};
  for (const t of result.trades) {
    const k = String(t.entryRegime);
    byRegime[k] = (byRegime[k] ?? 0) + 1;
  }
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
    byRegime,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

type Ablation = {
  id: string;
  label: string;
  regimes: string[];
  maxAtr: number;
  entryFilters?: BacktestConfig['entryFilters'];
};

const CONFIRM_STACK: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
};

const ABLATIONS: Ablation[] = [
  {
    id: 'strong_up_baseline',
    label: 'STRONG_UP only, MAX8, no confirm (paper-like)',
    regimes: ['STRONG_UP'],
    maxAtr: 8,
  },
  {
    id: 'strong_up_confirm',
    label: 'STRONG_UP + MAX2.5 + bullish + chase',
    regimes: ['STRONG_UP'],
    maxAtr: 2.5,
    entryFilters: CONFIRM_STACK,
  },
  {
    id: 'allow_up_bare',
    label: 'NEGATIVE CTRL: UP+STRONG_UP, MAX8, no confirm',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 8,
  },
  {
    id: 'allow_up_confirm',
    label: 'UP+STRONG_UP + MAX2.5 + bullish + chase',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: CONFIRM_STACK,
  },
  {
    id: 'allow_up_confirm_minatr',
    label: 'UP+STRONG_UP + MAX2.5 + bullish + chase + minATR≥1.5',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: { ...CONFIRM_STACK, minSignalAtrPercent: 1.5 },
  },
  {
    id: 'allow_up_confirm_only',
    label: 'UP+STRONG_UP + bullish + chase (MAX_ATR stays 8)',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 8,
    entryFilters: CONFIRM_STACK,
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ab.regimes;
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = ab.maxAtr;
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
      entryFilters: ab.entryFilters,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops} regimes=${JSON.stringify(summary.byRegime)}`,
    );
    return summary;
  } finally {
    restore(baseline);
  }
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  UP + confirm-stack ablations (robust 90/45)            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Allowing UP only under confirm+MAX_ATR+chase clears robust 90/45 with earlier n≥10; bare allow_UP remains a failing control.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      note: 'Paper soak dark: all HTF=UP, none STRONG_UP (2026-10-02).',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-up-confirm-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-up-confirm-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-up-confirm-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
