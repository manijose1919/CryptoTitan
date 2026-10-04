import { describe, expect, it } from 'vitest';
import { shouldForceUnlockLoop, shouldKickStaleLoop } from './loopWatchdog.ts';

describe('loopWatchdog', () => {
  const interval = 60_000;

  it('kicks when lastLoopAt is older than 3× interval', () => {
    expect(
      shouldKickStaleLoop({
        isRunning: true,
        lastLoopAt: 1_000_000,
        now: 1_000_000 + 3 * interval + 1,
        loopIntervalMs: interval,
      }),
    ).toBe(true);
  });

  it('does not kick when fresh or stopped', () => {
    expect(
      shouldKickStaleLoop({
        isRunning: true,
        lastLoopAt: 1_000_000,
        now: 1_000_000 + interval,
        loopIntervalMs: interval,
      }),
    ).toBe(false);
    expect(
      shouldKickStaleLoop({
        isRunning: false,
        lastLoopAt: 1_000_000,
        now: 1_000_000 + 10 * interval,
        loopIntervalMs: interval,
      }),
    ).toBe(false);
    expect(
      shouldKickStaleLoop({
        isRunning: true,
        lastLoopAt: 0,
        now: 1_000_000,
        loopIntervalMs: interval,
      }),
    ).toBe(false);
  });

  it('force-unlocks a mutex held longer than maxLoopMs', () => {
    expect(
      shouldForceUnlockLoop({
        loopInProgress: true,
        loopStartedAt: 1_000_000,
        now: 1_000_000 + 5 * 60_000 + 1,
        maxLoopMs: 5 * 60_000,
      }),
    ).toBe(true);
    expect(
      shouldForceUnlockLoop({
        loopInProgress: true,
        loopStartedAt: 1_000_000,
        now: 1_000_000 + 60_000,
        maxLoopMs: 5 * 60_000,
      }),
    ).toBe(false);
  });
});
