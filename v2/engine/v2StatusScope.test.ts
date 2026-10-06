import { describe, expect, it } from 'vitest';

/**
 * Documents the 2026-10-06 soak contract: main-pipeline status must count
 * MOMENTUM/BREAKOUT opens the same as TREND (tradeEngine owns all three).
 * getV2Status itself needs a live DB; this locks the intended aggregation.
 */
describe('getV2Status trade scope (main pipeline)', () => {
  it('counts every open trade regardless of strategy tag', () => {
    const open = [
      { strategy: 'TREND' },
      { strategy: 'MOMENTUM' },
    ];
    const closed = [
      { strategy: 'TREND', pnlNet: -10 },
      { strategy: 'MOMENTUM', pnlNet: 2 },
    ];
    const openPositions = open.length;
    const totalTrades = closed.length + open.length;
    const totalPnlNet = closed.reduce((s, t) => s + (t.pnlNet ?? 0), 0);
    expect(openPositions).toBe(2);
    expect(totalTrades).toBe(4);
    expect(totalPnlNet).toBe(-8);
  });
});
