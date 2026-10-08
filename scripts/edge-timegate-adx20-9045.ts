#!/usr/bin/env node
/**
 * TimeGate ablation under STRONG_UP+confirm+ADX20 paper stack (research only).
 *
 * Funnel autopsy: after STRONG_UP+ATR+ADX, timeGate drops ~158/268 earlier bars
 * and score drops ~94/110 — primary n-starve after regime. Hypothesis: current
 * timeGate (data-fit on older sample) over-blocks the ADX20+confirm stack.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic + confirmMomentum.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-timegate-adx20-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import * as timeGateMod from '../v2/pipeline/timeGate.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

const PAPER_FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
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
  /** Patch checkTimeGate for the run; restore after. */
  install: () => () => void;
};

const realCheck = timeGateMod.checkTimeGate;

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live_timegate',
    label: 'Paper live timeGate (control)',
    install: () => () => {},
  },
  {
    id: 'timegate_off',
    label: 'TimeGate always allow (no hour/dow block)',
    install: () => {
      (timeGateMod as { checkTimeGate: typeof realCheck }).checkTimeGate = () => ({
        allow: true,
        scoreBoost: 0,
        reason: 'off',
      });
      return () => {
        (timeGateMod as { checkTimeGate: typeof realCheck }).checkTimeGate = realCheck;
      };
    },
  },
  {
    id: 'timegate_allow_boost_only',
    label: 'TimeGate: hard-block off, keep scoreBoost hours as allow+0',
    install: () => {
      (timeGateMod as { checkTimeGate: typeof realCheck }).checkTimeGate = (t?: number) => {
        const r = realCheck(t);
        if (!r.allow) return { allow: true, scoreBoost: 0, reason: `was_block:${r.reason}` };
        return r;
      };
      return () => {
        (timeGateMod as { checkTimeGate: typeof realCheck }).checkTimeGate = realCheck;
      };
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const restore = ab.install();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
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
      entryFilters: { ...PAPER_FILTERS },
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf}`,
    );
    return summary;
  } finally {
    restore();
    (timeGateMod as { checkTimeGate: typeof realCheck }).checkTimeGate = realCheck;
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
  console.log('║  TimeGate ablation under ADX20+confirm stack (90/45)   ║');
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
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Funnel shows timeGate as the largest post-STRONG_UP+ADX drop; disabling hard blocks may clear n≥10 under confirm+ADX20.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `STRONG_UP MAX2.5 minAdx=${MIN_ADX} confirmMomentum chase0.8 minATR1.5`,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-timegate-adx20-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-timegate-adx20-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-timegate-adx20-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
