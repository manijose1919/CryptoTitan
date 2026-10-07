import { describe, it, expect } from 'vitest';
import { buildMonitorSummary } from './monitorSummary.ts';
import type { MonitorDeps } from './monitorSummary.ts';

// Minimal V2Trade factory — only the fields buildMonitorSummary reads.
function trade(over: Record<string, unknown> = {}): any {
  return {
    id: 'x', ticker: 'BTCUSD', side: 'long', status: 'closed',
    entryPrice: 100, entryTime: 1_000, quantity: 1, positionSizeUsd: 100,
    exitPrice: 110, exitTime: 2_000, exitReason: 'take_profit',
    pnlGross: 10, pnlNet: 9, feesPaid: 1, holdDurationMs: 1_000,
    initialStop: 90, currentStop: 95, takeProfitTarget: 120,
    strategy: 'TREND', entryRegime: 'UP', entryConfidence: 0.7,
    ...over,
  };
}

const baseStatus: any = {
  mode: 'paper', isRunning: true, lastLoopAt: 9_000, loopCount: 3,
  rejectedByScan: 0, rejectedBySignal: 0, rejectedByRisk: 0,
  htfRegimes: { BTCUSD: 'UP' }, openPositions: 0, totalTrades: 0,
  portfolioCash: 1000, totalPnlNet: 0,
};

function deps(over: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    status: baseStatus, openTrades: [], cohortClosedTrend: [], recentClosedAll: [],
    baselineTs: 1_784_740_967_690, baselineMissing: false, now: 9_999,
    ...over,
  } as MonitorDeps;
}

describe('buildMonitorSummary', () => {
  it('empty cohort → null rates, zero pnl, empty arrays (no throw)', () => {
    const s = buildMonitorSummary(deps());
    expect(s.cohort.tradeCount).toBe(0);
    expect(s.cohort.winRate).toBeNull();
    expect(s.cohort.avgR).toBeNull();
    expect(s.cohort.netPnl).toBe(0);
    expect(s.equityCurve).toEqual([]);
    expect(s.recentClosed).toEqual([]);
    expect(s.account.balance).toBe(1000);
  });

  it('computes winRate, netPnl and monotonic cumulative equity curve', () => {
    const cohortClosedTrend = [
      trade({ pnlNet: 9, exitTime: 3_000, entryTime: 2_500 }),   // win
      trade({ pnlNet: -4, exitTime: 2_000, entryTime: 1_800 }),  // loss
    ];
    const s = buildMonitorSummary(deps({ cohortClosedTrend, recentClosedAll: cohortClosedTrend }));
    expect(s.cohort.tradeCount).toBe(2);
    expect(s.cohort.netPnl).toBeCloseTo(5);
    expect(s.cohort.winRate).toBeCloseTo(0.5);
    // equity curve ordered oldest→newest by exitTime, cumulative
    expect(s.equityCurve.map(p => p.cumPnl)).toEqual([-4, 5]);
    // last cumPnl equals netPnl
    expect(s.equityCurve.at(-1)!.cumPnl).toBeCloseTo(s.cohort.netPnl);
  });

  it('avgR uses risk = |entry-initialStop|*qty', () => {
    // risk = |100-90|*1 = 10; R = pnlNet/risk = 9/10 = 0.9
    const s = buildMonitorSummary(deps({ cohortClosedTrend: [trade({ pnlNet: 9 })] }));
    expect(s.cohort.avgR).toBeCloseTo(0.9);
  });

  it('recentClosed derives outcome from pnlNet and caps at 25 newest', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      trade({ pnlNet: i % 2 === 0 ? 5 : -5, exitTime: 1_000 + i }));
    const s = buildMonitorSummary(deps({ recentClosedAll: many }));
    expect(s.recentClosed.length).toBe(25);
    // newest first (highest exitTime)
    expect(s.recentClosed[0].exitTs).toBe(1_029);
    expect(['WIN', 'LOSS', 'BREAKEVEN']).toContain(s.recentClosed[0].outcome);
  });

  it('cohort KPIs use caller-filtered main pipeline; recentClosed can include sniper/contaminated', () => {
    const mainTrades = [
      trade({ pnlNet: 9, exitTime: 3_000, entryTime: 2_500, strategy: 'TREND' }),
      trade({ pnlNet: -4, exitTime: 2_000, entryTime: 1_800, strategy: 'MOMENTUM' }),
    ];
    const sniperTrade = trade({
      pnlNet: 1_000, exitTime: 4_000, entryTime: 3_900, strategy: 'SNIPER_KRAKEN',
    });
    const contaminated = trade({
      id: 'f69f31c0-ae44-4c4f-b7c2-901bb279b35a',
      pnlNet: -12.99, exitTime: 5_000, strategy: 'MOMENTUM',
    });
    // Caller (attributionAPI) already drops sniper/contaminated from cohortClosedTrend.
    const recentClosedAll = [...mainTrades, sniperTrade, contaminated];
    const s = buildMonitorSummary(deps({ cohortClosedTrend: mainTrades, recentClosedAll }));

    expect(s.cohort.tradeCount).toBe(2);
    expect(s.cohort.netPnl).toBeCloseTo(5);
    expect(s.equityCurve.map(p => p.cumPnl)).toEqual([-4, 5]);

    expect(s.recentClosed).toHaveLength(4);
    expect(s.recentClosed.some(r => r.strategy === 'SNIPER_KRAKEN')).toBe(true);
    expect(s.recentClosed.some(r => r.pnlNet === -12.99)).toBe(true);
  });

  it('maps open positions from openTrades', () => {
    const openTrades = [trade({ status: 'open', ticker: 'ETHUSD', strategy: 'MOMENTUM',
      side: 'long', entryPrice: 50, positionSizeUsd: 200, currentStop: 45,
      takeProfitTarget: 60, entryTime: 4_000 })];
    const s = buildMonitorSummary(deps({ openTrades }));
    expect(s.openPositions).toHaveLength(1);
    expect(s.openPositions[0]).toMatchObject({
      ticker: 'ETHUSD', strategy: 'MOMENTUM', side: 'long',
      entry: 50, positionSizeUsd: 200, stop: 45, target: 60,
    });
    expect(s.account.openPositionsCount).toBe(1);
  });

  it('account.openPositionsCount equals openTrades.length regardless of strategy mix; cohort has no openCount', () => {
    const openTrades = [
      trade({ status: 'open', ticker: 'ETHUSD', strategy: 'MOMENTUM' }),
      trade({ status: 'open', ticker: 'BTCUSD', strategy: 'SNIPER_KRAKEN' }),
    ];
    const s = buildMonitorSummary(deps({ openTrades }));
    expect(s.account.openPositionsCount).toBe(openTrades.length);
    expect((s.cohort as any).openCount).toBeUndefined();
  });

  it('regime falls back to first htfRegime then UNKNOWN', () => {
    expect(buildMonitorSummary(deps()).status.regime).toBe('UP');
    const noBtc = { ...baseStatus, htfRegimes: {} };
    expect(buildMonitorSummary(deps({ status: noBtc })).status.regime).toBe('UNKNOWN');
  });

  it('flags stale engine when lastLoopAt (wall-clock heartbeat) is old, fresh when recent', () => {
    const now = 10_000_000;
    const fresh = buildMonitorSummary(deps({
      status: { ...baseStatus, lastLoopAt: now - 1_000 }, now,
    }));
    expect(fresh.status.stale).toBe(false);

    const old = buildMonitorSummary(deps({
      status: { ...baseStatus, lastLoopAt: now - 10 * 60_000 }, now,
    }));
    expect(old.status.stale).toBe(true);
  });

  it('flags stale when engine is not running, even with a fresh lastLoopAt', () => {
    const now = 10_000_000;
    const s = buildMonitorSummary(deps({
      status: { ...baseStatus, isRunning: false, lastLoopAt: now - 1_000 }, now,
    }));
    expect(s.status.stale).toBe(true);
  });
});
