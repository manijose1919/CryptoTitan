# 2026-10-11 — Bearish wall-clock watchdog (suspend parity)

## Soak
- `:3137` paper; open 0; risk-off; shorts off / DCA sim.
- Midday resume after ~41875s WS dead: Connected→online **no 1006**; main `Watchdog kick` ran loop.
- DOTUSD still ATR%~2.71 > MAX 2.5 when previously STRONG_UP (now UP) — keep ceiling.

## Gap
Main trade loop has a wall-clock watchdog; bearish eval relied only on `setInterval`. After suspend, `lastEvalAt` can lag until the interval catches up (sampled stale at resume, then advanced ~1 min later).

## Change
- `bearishServices`: 30s watchdog tick using `shouldKickStaleLoop` (3× `EVAL_INTERVAL_MS`).
- Skip kick when an eval is already in flight (&lt;120s) — same benign race as main loop.
- Test: stale threshold matches main loop helper.

## Decision
No trading-config change. Paper restart to load watchdog. Continue locked stack soak.
