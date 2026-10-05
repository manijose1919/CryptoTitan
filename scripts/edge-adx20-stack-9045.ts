#!/usr/bin/env node
/**
 * Search for a promote-capable stack under paper ADX parity (minAdx=20).
 *
 * Context: promote package (UP+confirm+chase+minATR1.5+MAX2.5) clears without
 * ADX but fails robust 90/45 with minAdx=20 (OOS PF≈0.87). Paper keeps ADX≥20.
 * Hypothesis: a tighter or alternate stack can clear *with* ADX parity.
 *
 * All ablations include minAdx=20. Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-adx20-stack-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN; // 20

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
  entryFilters: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  {
    id: 'strong_confirm_adx20',
    label: 'STRONG_UP + MAX2.5 + bullish + chase + ADX20 (paper-like no UP)',
    regimes: ['STRONG_UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'promote_adx20_ctrl',
    label: 'CTRL: promote package + ADX20 (known fail)',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'up_confirm_adx20_no_chase',
    label: 'UP+confirm+minATR1.5+MAX2.5+ADX20, no chase',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      minSignalAtrPercent: 1.5,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'up_confirm_adx20_no_minatr',
    label: 'UP+confirm+chase+MAX2.5+ADX20, no minATR',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'up_confirm_adx20_max3',
    label: 'UP+confirm+chase+minATR1.5+MAX3.0+ADX20',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 3.0,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'up_confirm_adx20_close_above',
    label: 'UP+close_above_signal+chase+minATR1.5+MAX2.5+ADX20',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'close_above_signal',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'up_confirm_adx20_both',
    label: 'UP+bullish_and_above+chase+minATR1.5+MAX2.5+ADX20',
    regimes: ['STRONG_UP', 'UP'],
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_and_above',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'strong_up_bare_adx20',
    label: 'STRONG_UP only MAX8 + ADX20 (no confirm)',
    regimes: ['STRONG_UP'],
    maxAtr: 8,
    entryFilters: { minAdx: MIN_ADX },
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
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ADX≥20 stack search (robust 90/45)                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      regimes: ab.regimes,
      maxAtr: ab.maxAtr,
      entryFilters: ab.entryFilters,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const promoters = rows.filter((r) => r.meetsPromotionBar);
  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Under paper ADX≥20, some alternate confirm/regime/ATR stack clears robust 90/45 where the original promote package does not.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `minAdx=${MIN_ADX} on every ablation`,
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    rows,
    anyPromote: promoters.length > 0,
    promoters: promoters.map((r) => r.id),
  };
  writeFileSync('/opt/cursor/artifacts/edge-adx20-stack-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-adx20-stack-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-adx20-stack-9045.json anyPromote=${out.anyPromote} promoters=${JSON.stringify(out.promoters)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
