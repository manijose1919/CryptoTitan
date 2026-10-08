#!/usr/bin/env node
/**
 * Score vs confidence gate coherence under ADX20+confirm paper stack.
 *
 * Funnel: after timeGate, score/conf drops ~94 earlier bars. Feature probes showed
 * MIN_COMPOSITE_SCORE 55/65 identical to live — hypothesized because MIN_CONFIDENCE=0.65
 * requires composite≥65, making score threshold and TimeGate scoreBoost dead letters.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic + confirmMomentum.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-score-conf-coherence-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = {
  regimes: readonly string[];
  maxAtr: number;
  minScore: number;
  minConf: number;
  momEnabled: boolean;
};

function snap(): Snap {
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    minScore: V2_CONFIG.MIN_COMPOSITE_SCORE,
    minConf: V2_CONFIG.MIN_CONFIDENCE,
    momEnabled: MOMENTUM_CONFIG.ENABLED,
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = s.minScore;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = s.minConf;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.momEnabled;
}

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

const PAPER_FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

type Ablation = {
  id: string;
  label: string;
  entryFilters?: BacktestConfig['entryFilters'];
  apply: () => void;
};

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live',
    label: 'Paper live (score60 + conf0.65)',
    apply: () => {},
  },
  {
    id: 'conf_060_align',
    label: 'MIN_CONFIDENCE 0.65→0.60 (align with score60)',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
    },
  },
  {
    id: 'conf_055_scoreboost_parity',
    label: 'MIN_CONFIDENCE→0.55 (parity with score60−boost5)',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
    },
  },
  {
    id: 'score_65_conf_065',
    label: 'MIN_COMPOSITE_SCORE→65 (match confidence binding)',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 65;
    },
  },
  {
    id: 'score_55_conf_055',
    label: 'score55 + conf0.55 (joint loosen — labeled)',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 55;
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
    },
  },
  {
    id: 'conf_060_chase_075',
    label: 'conf0.60 + chase≤0.75 (n recover + quality)',
    entryFilters: { ...PAPER_FILTERS, maxSignalCloseLocation: 0.75 },
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
    },
  },
  {
    id: 'conf_055_chase_075',
    label: 'conf0.55 + chase≤0.75',
    entryFilters: { ...PAPER_FILTERS, maxSignalCloseLocation: 0.75 },
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
    },
  },
  {
    id: 'conf_055_chase_075_range2',
    label: 'conf0.55 + chase≤0.75 + rangeAtr≤2.0',
    entryFilters: {
      ...PAPER_FILTERS,
      maxSignalCloseLocation: 0.75,
      maxSignalRangeAtrMult: 2.0,
    },
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
    },
  },
  {
    id: 'conf_060_chase_075_range2',
    label: 'conf0.60 + chase≤0.75 + rangeAtr≤2.0',
    entryFilters: {
      ...PAPER_FILTERS,
      maxSignalCloseLocation: 0.75,
      maxSignalRangeAtrMult: 2.0,
    },
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
    },
  },
  {
    id: 'conf_055_chase_070',
    label: 'conf0.55 + chase≤0.70',
    entryFilters: { ...PAPER_FILTERS, maxSignalCloseLocation: 0.7 },
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
    ab.apply();
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
      entryFilters: { ...(ab.entryFilters ?? PAPER_FILTERS) },
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`,
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
  console.log('║  Score/conf coherence under ADX20+confirm (90/45)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier90 = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos45 = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    rows.push({
      id: ab.id,
      label: ab.label,
      earlier90,
      oos45,
      meetsPromotionBar: meetsBar(oos45, earlier90),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'MIN_CONFIDENCE=0.65 binds entries at composite≥65; MIN_COMPOSITE_SCORE=60 and TimeGate scoreBoost are ineffective. Aligning conf→0.60 may recover funnel score/conf n without changing score.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: 'STRONG_UP MAX2.5 minAdx=20 confirmMomentum chase0.8 minATR1.5',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };

  writeFileSync('/opt/cursor/artifacts/edge-score-conf-coherence-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-score-conf-coherence-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-score-conf-coherence-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.meetsPromotionBar ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
