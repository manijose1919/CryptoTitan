# 2026-10-22 overnight — Promote-stack longer-window stress

## Soak
- `:3137` paper; open 0; cohort 0 (post tk4 baseline); pnl history −$64.72 / 6 trades excluded.
- ~41822s VM suspend: WS Dead→reconnect; Watchdog benign skip (recovery loop in flight); `stale` cleared; `V2_LIVE_CONFIRMED=no`.
- Regimes: BTC/BNB UP (blocked); rest SIDEWAYS/DOWN; F&G ~59 Neutral; shorts off; DCA sim; GUI 200.

## Ask
Does the full promote stack (no_overnight + conf0.60 + chase0.85 + TREND timeKillBars=4 + locked ADX/confirm/ATR) survive longer splits than 90/45 and 60/60?

## Results (static weights)

| split | earlier | OOS | pass |
|---|---|---|---|
| **90/45** | n=16 PF**3.17** +$37.50 | n=10 PF**2.48** +$15.80 | **PASS** |
| **60/60** | n=11 PF**2.57** +$20.14 | n=16 PF**2.89** +$30.42 | **PASS** |
| **120/60** | n=17 PF**1.65** +$15.96 | n=16 PF**2.89** +$30.42 | **PASS** |
| **150/75** | n=14 PF**2.01** +$19.66 | n=19 PF**2.20** +$30.31 | **PASS** |

`allPass=true`. Exit mix on longer OOS: trailing dominates; residual drag is stop_loss (≈−$20 on 150/75 OOS n=2).

## Interpretation
- Dual-split clear is **not** a 90/45 calendar artifact — 120/60 and 150/75 also clear fee-aware promote bar.
- Calendar roll vs 2026-10-21 tk4 run shifted 90/45 earlier n 18→16 with higher PF (1.90→3.17) — still healthy.
- No trading-config change. Next research lever if soak stays empty: stop_loss feature autopsy (remaining fee-aware drag), not entry loosen / UP re-enable.

## Code / artifacts
- `scripts/edge-promote-stack-stress-9045.ts`
- `/tmp/cryptotitan-artifacts/edge-promote-stack-stress-9045.json`

## Decision
Keep paper promote stack. Soak for STRONG_UP fills.
