# 2026-10-26 overnight — vol floor neighborhood + stack stress (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72 history; F&G ~59 Neutral.
- BNBUSD **UP** ATR% ~0.944 &lt; min 1.5 (still multi-day); rest DOWN/STRONG_DOWN.
- ~41598–41626s suspend → WS reconnect + dual Watchdog; mode=paper; `V2_LIVE_CONFIRMED=no`.
- Bearish: shorts off; DCA sim-only; GUI `/` and `/api/health` 200.

## Volume-ratio floor under UP+ADX15+MAX2.8

| variant | dual | Σnet | notes |
|---|---|---|---|
| vol off | PASS | $135.5 | much worse than paper |
| vol 0.15 | PASS | $189.5 | below paper |
| **paper 0.20** | **PASS** | **$215.5** | 90/45 n=48/19; 60/60 n=14/38 |
| vol 0.25 | PASS | $211.4 | slight Σnet drop + n drop |
| vol 0.30 | PASS | $216.1 | +$0.68 vs paper; 60/60 earlier 14→13 |

**No promote** — vol 0.30 is a micro Σnet bump with n-starve. Keep `MIN_SIGNAL_VOLUME_RATIO=0.20`.

## Stress regression (paper stack)

| split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=48 PF=2.789 net=$101 | n=19 PF=2.813 net=$36 | PASS |
| 60/60 | n=14 PF=2.38 net=$24 | n=38 PF=2.049 net=$55 | PASS |
| 120/60 | n=33 PF=2.194 net=$42 | n=38 PF=2.049 net=$55 | PASS |
| 150/75 | n=31 PF=2.155 net=$40 | n=43 PF=2.189 net=$71 | PASS |

`allPass=true` — current UP+ADX15+MAX2.8+vol0.20 stack remains promote-bar clean on long stress.

## Decision
No trading-config change. Entry softens around vol/conf/chase/minATR are exhausted for this stack; wait for in-band UP/STRONG_UP.

## Code / artifacts
- `scripts/edge-vol-adx15-stack-9045.ts`
- `scripts/edge-stack-stress-adx15-9045.ts`
- `/tmp/cryptotitan-artifacts/edge-vol-adx15-stack-9045.json`
- `/tmp/cryptotitan-artifacts/edge-stack-stress-adx15-9045.json`
