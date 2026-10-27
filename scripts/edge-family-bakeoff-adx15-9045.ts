#!/usr/bin/env node
/**
 * Fee-aware strategy-family bake-off refresh under current promote bar.
 * Dual-split 90/45 + 60/60: OOS PF≥1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 * Families locked before results — no ticker cherry-pick / no TREND knob mining.
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { STRATEGY_CONFIGS } from '../v2/backtest/multiStrategy/strategyRegistry.ts';
import { runMultiStrategyBacktest } from '../v2/backtest/multiStrategy/multiStrategyEngine.ts';
import type { StrategyConfig } from '../v2/backtest/multiStrategy/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const FEE_RT = V2_CONFIG.FEE_ROUND_TRIP_TAKER;
const SLIP = V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE;
const EXEC = { nextBarOpen: true, slippagePerSide: SLIP, gapAwareStops: true };

function family(name: keyof typeof STRATEGY_CONFIGS, overrides: Partial<StrategyConfig>): StrategyConfig {
  const base = STRATEGY_CONFIGS[name];
  return {
    ...base,
    ...overrides,
    entryParams: { ...base.entryParams, ...(overrides.entryParams ?? {}) },
    exitParams: { ...base.exitParams, ...(overrides.exitParams ?? {}) },
    allowedRegimes: overrides.allowedRegimes ?? [...base.allowedRegimes],
    allowedTimeframes: overrides.allowedTimeframes ?? [...base.allowedTimeframes],
  };
}

/** Locked contestants (pre-registered). */
const FAMILIES: Array<{ id: string; strategy: StrategyConfig; timeframes: string[] }> = [
  {
    id: 'TREND_STRONG_UP_4h',
    timeframes: ['4h'],
    strategy: family('TREND', {
      allowedRegimes: ['STRONG_UP'],
      allowedTimeframes: ['4h'],
    }),
  },
  {
    id: 'TREND_SU_UP_4h',
    timeframes: ['4h'],
    strategy: family('TREND', {
      allowedRegimes: ['STRONG_UP', 'UP'],
      allowedTimeframes: ['4h'],
    }),
  },
  {
    id: 'MOMENTUM_STRONG_UP_4h',
    timeframes: ['4h'],
    strategy: family('MOMENTUM', {
      allowedRegimes: ['STRONG_UP'],
      allowedTimeframes: ['4h'],
    }),
  },
  {
    id: 'BREAKOUT_SU_UP_4h',
    timeframes: ['4h'],
    strategy: family('BREAKOUT', {
      allowedRegimes: ['STRONG_UP', 'UP'],
      allowedTimeframes: ['4h'],
      entryParams: {
        ...STRATEGY_CONFIGS.BREAKOUT.entryParams,
        minAtrPercent: 1.0,
      },
    }),
  },
  {
    id: 'MR_SIDEWAYS_1h',
    timeframes: ['1h'],
    strategy: family('MEAN_REVERSION', {
      allowedRegimes: ['SIDEWAYS'],
      allowedTimeframes: ['1h'],
    }),
  },
];

function summarize(result: {
  summary: {
    totalTrades: number;
    winRate: number;
    totalPnlNet: number;
    profitFactor: number;
  };
}) {
  const s = result.summary;
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

async function runWindow(label: string, days: number, end: Date, fam: (typeof FAMILIES)[number]) {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n=== ${label} | ${fam.id} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const report = await runMultiStrategyBacktest({
    tickers: CAD10,
    startDate,
    endDate: end,
    budget: 1000 * CAD10.length,
    timeframes: fam.timeframes,
    strategies: [fam.strategy],
    feeRoundTrip: FEE_RT,
    execution: EXEC,
  });
  const result = report.results[0];
  if (!result) {
    return { trades: 0, winRate: 0, net: 0, pf: 0 as number | null };
  }
  const summary = summarize(result);
  console.log(`  → n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`);
  return summary;
}

async function dual(fam: (typeof FAMILIES)[number], end: Date) {
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await runWindow(`${fam.id}/earlier90`, 90, end45, fam);
  const oos45 = await runWindow(`${fam.id}/oos45`, 45, end, fam);
  const earlier60 = await runWindow(`${fam.id}/earlier60`, 60, end60, fam);
  const oos60 = await runWindow(`${fam.id}/oos60`, 60, end, fam);
  const pass9045 = meetsBar(oos45, earlier90);
  const pass6060 = meetsBar(oos60, earlier60);
  const sumNet =
    (earlier90.net || 0) + (oos45.net || 0) + (earlier60.net || 0) + (oos60.net || 0);
  return {
    id: fam.id,
    regimes: fam.strategy.allowedRegimes,
    timeframes: fam.timeframes,
    split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
    split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
    dualPass: pass9045 && pass6060,
    sumNet: Number(sumNet.toFixed(2)),
  };
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  console.log('Fee-aware family bake-off (ADX15-era dual-split bar)');
  console.log(`CAD: ${CAD10.join(',')} | fee ${(FEE_RT * 100).toFixed(2)}% RT + ${(SLIP * 100).toFixed(2)}%/side`);

  const rows = [];
  for (const fam of FAMILIES) {
    console.log(`\n######## ${fam.id} ########`);
    const row = await dual(fam, end);
    rows.push(row);
    console.log(`  dualPass=${row.dualPass} Σnet=$${row.sumNet}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Alternate-family bake-off refresh under dual-split promote bar (research only)',
    protocol: {
      feeRoundTrip: FEE_RT,
      slippagePerSide: SLIP,
      execution: EXEC,
      promotionBar: 'dual 90/45+60/60: OOS PF≥1.1 & net>0 & earlier PF≥0.9 & earlier n≥10',
      notes: [
        'Does not enable MR/BREAKOUT in paper config',
        'TREND rows are multi-strategy engine baselines (not full paper quality stack)',
        'MR uses 1h due to Kraken OHLC history limits',
      ],
    },
    rows,
    anyDualPass: rows.some((r) => r.dualPass),
    dualPassIds: rows.filter((r) => r.dualPass).map((r) => r.id),
  };
  const paths = writeResearchArtifact('edge-family-bakeoff-adx15-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, anyDualPass: out.anyDualPass, dualPassIds: out.dualPassIds }, null, 2));
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
