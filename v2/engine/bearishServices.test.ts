import { describe, expect, it } from 'vitest';
import { BEARISH_CONFIG, getBearishStatus } from './bearishServices.ts';
import { shouldKickStaleLoop } from './loopWatchdog.ts';

describe('bearish side-service safety', () => {
  it('keeps unvalidated and potentially real side services disabled', () => {
    expect(BEARISH_CONFIG.SHORT_ENABLED).toBe(false);
    expect(BEARISH_CONFIG.STAKING_ENABLED).toBe(false);
    expect(BEARISH_CONFIG.ARB_ENABLED).toBe(false);
    expect(BEARISH_CONFIG.DCA_SIM_ONLY).toBe(true);
  });

  it('reports wrapper enablement instead of stale nested defaults', () => {
    const status = getBearishStatus();
    expect(status.shorts.enabled).toBe(false);
    expect(status.staking.enabled).toBe(false);
    expect(status.arbitrage.enabled).toBe(false);
  });

  it('exposes lastEvalAt wall clock distinct from lastEvalTime duration ms', () => {
    const status = getBearishStatus();
    expect(status.stats).toHaveProperty('lastEvalTime');
    expect(status.stats).toHaveProperty('lastEvalAt');
    expect(typeof status.stats.lastEvalTime).toBe('number');
    expect(typeof status.stats.lastEvalAt).toBe('number');
  });

  it('stale lastEvalAt after suspend uses same 3× interval kick as main loop', () => {
    const interval = BEARISH_CONFIG.EVAL_INTERVAL_MS;
    const now = 1_700_000_000_000;
    expect(
      shouldKickStaleLoop({
        isRunning: true,
        lastLoopAt: now - interval * 2,
        now,
        loopIntervalMs: interval,
      }),
    ).toBe(false);
    expect(
      shouldKickStaleLoop({
        isRunning: true,
        lastLoopAt: now - interval * 3 - 1,
        now,
        loopIntervalMs: interval,
      }),
    ).toBe(true);
  });
});
