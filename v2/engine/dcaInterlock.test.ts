import { describe, expect, it } from 'vitest';
import { BEARISH_CONFIG } from './bearishServices.ts';
import { isLiveTradingConfirmed } from './tradeMode.ts';
import { describeBearishBootSummary } from './bearishBootSummary.ts';

describe('DCA real-order interlock', () => {
  it('keeps DCA on sim-only until an explicit future live enablement', () => {
    expect(BEARISH_CONFIG.DCA_SIM_ONLY).toBe(true);
  });

  it('refuses real DCA when the dual live interlock is not confirmed', () => {
    // Defense-in-depth contract: even if DCA_SIM_ONLY were flipped false,
    // paper / unconfirmed-live must not place exchange orders.
    expect(isLiveTradingConfirmed('paper', 'no')).toBe(false);
    expect(isLiveTradingConfirmed('live', 'no')).toBe(false);
    expect(isLiveTradingConfirmed('live', 'yes')).toBe(true);
  });
});

describe('bearish boot summary honesty', () => {
  it('does not claim shorts/staking/arb are running when wrappers keep them off', () => {
    const summary = describeBearishBootSummary({
      SHORT_ENABLED: false,
      STAKING_ENABLED: false,
      ARB_ENABLED: false,
      DCA_SIM_ONLY: true,
      DCA_FEAR_ENABLED: true,
    });
    expect(summary).toContain('shorts=off');
    expect(summary).toContain('staking=off');
    expect(summary).toContain('arb=off');
    expect(summary).toContain('dca=sim');
    expect(summary).not.toMatch(/shorts, staking, arb, DCA/);
  });
});
