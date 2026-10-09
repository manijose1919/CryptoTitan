# 2026-10-09 — Bearish `lastEvalAt` for soak monitors

## Issue
`/api/v2/bearish/status` `stats.lastEvalTime` is **duration ms** of the last eval (often `0` when sub-ms), not a wall-clock timestamp. Soak checks misread it as stale.

## Fix
- Keep `lastEvalTime` as duration ms.
- Add `stats.lastEvalAt` = `Date.now()` when evaluate() finishes.
- Unit test asserts both fields exist.

## Verify
After paper restart: `lastEvalAt` nonzero, SHORT=false, DCA_SIM=true, mode=paper.
