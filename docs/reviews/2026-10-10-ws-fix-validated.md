# 2026-10-10 — Kraken WS suspend fix validated + watchdog kick clarity

## Soak
- `:3137` paper; open 0; cohort 0; risk-off; shorts off / DCA sim.
- Suspend ~12h; watchdog age ~42329s.

## WS fix validation (shipped 2026-10-09)
After `Dead for ~42ks — forcing reconnect`:
```
Connected → Subscribed → System status online
```
**No immediate `Disconnected (code: 1006)`** on this cycle (pre-fix pattern was Connected→1006 within seconds). Stale-close guard holds.

## Watchdog “Loop skipped”
Same resume: `Watchdog kick` then `Loop skipped — previous iteration still running`.  
Cause: setInterval starts a recovery `runLoop` before the watchdog kick; `lastLoopAt` is still pre-suspend stale but `loopInProgress` is fresh — second kick is redundant.

### Change
- `isBenignStaleKickSkip` helper + tests.
- Watchdog logs `recovery loop already in flight — skip kick` instead of a failed kick→skip pair.
- Status exposes `wsConnected` + `pendingConfirmCount` for soak monitors.

## Decision
No trading-config change. Keep locked stack. Continue watching next suspend for WS stability + clearer watchdog logs.
