// ============================================
// Wall-clock loop watchdog (VM suspend recovery)
// Node timers freeze with the host; lastLoopAt is wall-clock, so after resume
// the monitor shows stale until setInterval catches up. This helper decides
// when to kick runLoop and when to force-clear a stuck loopInProgress mutex.
// ============================================

export interface StaleLoopInput {
  isRunning: boolean;
  lastLoopAt: number;
  now: number;
  loopIntervalMs: number;
  /** Kick when age > mult × interval (default 3 → ~3 min at 60s loop). */
  staleMult?: number;
}

export interface StuckMutexInput {
  loopInProgress: boolean;
  loopStartedAt: number;
  now: number;
  /** Force-unlock if a single loop exceeds this (default 5 min). */
  maxLoopMs: number;
}

/** True when the engine should be running but lastLoopAt is wall-clock stale. */
export function shouldKickStaleLoop(input: StaleLoopInput): boolean {
  if (!input.isRunning) return false;
  if (input.lastLoopAt <= 0) return false;
  if (input.loopIntervalMs <= 0) return false;
  const mult = input.staleMult ?? 3;
  return input.now - input.lastLoopAt > input.loopIntervalMs * mult;
}

/** True when loopInProgress has been held longer than maxLoopMs (hung await). */
export function shouldForceUnlockLoop(input: StuckMutexInput): boolean {
  if (!input.loopInProgress) return false;
  if (input.loopStartedAt <= 0) return false;
  return input.now - input.loopStartedAt > input.maxLoopMs;
}
