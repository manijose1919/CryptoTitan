# 2026-10-07 — Fear & Greed stale after VM suspend

## Symptom
Paper `:3137` health showed `fearGreed.lastFetchTime` ~11h behind wall clock while `process.uptime()` was only ~20 minutes (timers paused during suspend; wall clock jumped).

## Fix
- `isFearGreedFetchStale` / `refreshFearGreedIfStale` in `services/fearGreedGate.js` (wall-clock age > 30m).
- `getFearGreedStatus` kicks a non-blocking refresh when stale.
- Each trading loop calls `refreshFearGreedIfNeeded()` via riskGate.

## Verify
After deploy/restart (or next loop): `lastFetchTime` within ~30m of wall clock; Alt.me refresh log line appears if it was stale.
