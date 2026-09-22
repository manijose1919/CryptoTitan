#!/usr/bin/env node
/**
 * Fee-aware strategy-family bake-off (research only).
 *
 * Same promotion bar as edge-ablation-matrix:
 *   OOS(recent45) PF>1.2 AND net>0 AND earlier45 PF>=0.9
 *
 * Execution: next-bar open + 5bps/side + 0.52% RT taker + gap-aware stops.
 * Families locked before results (production-aligned regimes; no TREND knob mining).
 *
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-family-bakeoff.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { STRATEGY_CONFIGS } from '../v2/backtest/multiStrategy/strategyRegistry.ts';
import { runMultiStrategyBacktest } from '../v2/backtest/multiStrategy/multiStrategyEngine.ts';
import type { StrategyConfig } from '../v2/backtest/multiStrategy/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const FEE_RT = V2_CONFIG.FEE_ROUND_TRIP_TAKER;
const SLIP = V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE;
const EXEC = { nextBarOpen: true, slippagePerSide: SLIP, gapAwareStops: true };

/** Deep-clone a registry strategy and override regimes/timeframes for the locked contest. */
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

/**
 * Locked family definitions (set before seeing results):
 * - TREND control: STRONG_UP / 4h (matches paper soak)
 * - MOMENTUM: STRONG_UP / 4h (production MOMENTUM_CONFIG)
 * - BREAKOUT: STRONG_UP+UP / 4h (live breakoutSignal regimes; 4h for CAD fee room)
 * - MEAN_REVERSION: SIDEWAYS / 1h (15m skipped — Kraken history too short for 90d halves)
 */
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
    id: 'MOMENTUM_STRONG_UP_4h',
    timeframes: ['4h'],
    strategy: family('MOMENTUM', {
      allowedRegimes: ['STRONG_UP'],
      allowedTimeframes: ['4h'],
    }),
  },
  {
    id: 'BREAKOUT_UP_STRONG_UP_4h',
    timeframes: ['4h'],
    strategy: family('BREAKOUT', {
      allowedRegimes: ['STRONG_UP', 'UP'],
      allowedTimeframes: ['4h'],
      entryParams: {
        ...STRATEGY_CONFIGS.BREAKOUT.entryParams,
        minAtrPercent: 1.0, // align with production ATR floor; not a loosening
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

function summarize(result: { summary: {
  totalTrades: number; winRate: number; totalPnlNet: number; profitFactor: number;
  avgWinPnl: number; avgLossPnl: number; maxDrawdownPercent: number;
}}) {
  const s = result.summary;
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
    maxDdPct: Number(s.maxDrawdownPercent.toFixed(2)),
  };
}

function meetsBar(oos: { pf: number | null; net: number }, earlier: { pf: number | null }): boolean {
  return (oos.pf ?? 0) > 1.2 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9;
}

async function runWindow(
  label: string,
  days: number,
  end: Date,
  family: typeof FAMILIES[number],
) {
  const endDate = end;
  const startDate = new Date(endDate.getTime() - days * 86400000);
  console.log(`\n=== ${label} | ${family.id} | ${startDate.toISOString().slice(0, 10)}→${endDate.toISOString().slice(0, 10)}`);
  const report = await runMultiStrategyBacktest({
    tickers: CAD10,
    startDate,
    endDate,
    budget: 1000 * CAD10.length,
    timeframes: family.timeframes,
    strategies: [family.strategy],
    feeRoundTrip: FEE_RT,
    execution: EXEC,
  });
  const result = report.results[0];
  if (!result) {
    return {
      trades: 0, winRate: 0, net: 0, pf: 0, avgWin: 0, avgLoss: 0, maxDdPct: 0,
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    };
  }
  const summary = summarize(result);
  console.log(`  → trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf}`);
  return {
    ...summary,
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Fee-aware strategy-family bake-off (locked)        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`CAD tickers: ${CAD10.join(',')}`);
  console.log(`Fees: ${(FEE_RT * 100).toFixed(2)}% RT + ${(SLIP * 100).toFixed(2)}%/side | next-bar + gap-aware`);
  console.log('Promotion bar: oos45 PF>1.2 & net>0 & earlier45 PF>=0.9');

  const matrix: Array<Record<string, unknown>> = [];

  for (const fam of FAMILIES) {
    const full = await runWindow(`${fam.id}/full90`, 90, endRecent, fam);
    const earlier = await runWindow(`${fam.id}/earlier45`, 45, endEarlier, fam);
    const oos = await runWindow(`${fam.id}/oos45`, 45, endRecent, fam);
    const row = {
      id: fam.id,
      regimes: fam.strategy.allowedRegimes,
      timeframes: fam.timeframes,
      full90: full,
      earlier45: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    matrix.push(row);
    console.log(`== ${fam.id}: pass=${row.meetsPromotionBar} OOS PF=${oos.pf} net=$${oos.net} earlier PF=${earlier.pf}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    protocol: {
      execution: EXEC,
      feeRoundTrip: FEE_RT,
      tickers: CAD10,
      promotionBar: 'oos45 PF>1.2 AND oos45 net>0 AND earlier45 PF>=0.9',
      notes: [
        'Research only — does not enable MR/breakout/momentum in paper/live config',
        'TREND included as fee-aware control under same multi-strategy engine',
        'MR uses 1h (not 15m) due to Kraken public OHLC history limits',
      ],
    },
    matrix,
    anyPromotionPass: matrix.some((r) => r.meetsPromotionBar === true),
  };

  const path = '/opt/cursor/artifacts/edge-family-bakeoff.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  console.log(`Any family meets promotion bar: ${out.anyPromotionPass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
