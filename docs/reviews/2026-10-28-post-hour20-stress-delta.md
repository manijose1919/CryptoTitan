# 2026-10-28 midday — post hour-20 promote stress + trade delta

## Soak
- `:3137` paper after promote restart; `BLOCKED_HOURS=[13]`; baseline `1793148229501`.
- open 0; cohort 0; BNBUSD **UP** ATR% ~0.98 &lt; min 1.5; peers SIDEWAYS/DOWN.
- ~39901–39913s suspend → WS + Watchdog recovery; mode=paper; `V2_LIVE_CONFIRMED=no`.
- GUI 200; shorts off; DCA sim-only.

## Stress reconfirm (TG [13])

| split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=48 PF=2.784 net=$101 | n=15 PF=1.809 net=$16 | PASS |
| 60/60 | n=17 PF=3.04 net=$35 | n=35 PF=1.659 net=$40 | PASS |
| 120/60 | n=41 PF=1.933 net=$44 | n=35 PF=1.659 net=$40 | PASS |
| 150/75 | n=37 PF=1.695 net=$33 | n=49 PF=2.335 net=$90 | PASS |

`allPass=true` — promoted package holds on longer windows.

## Hour-20 unblock trade delta

Comparing `[13,20]` vs `[13]` under identical stack:

| window | base n/net | new n | added n | added net | added entry hours |
|---|---|---|---|---|---|
| oos45 | 13 / $7.71 | 15 | 2 | +$8.13 | all **04:00** UTC |
| oos60 | 30 / $20.31 | 35 | 5 | +$22.19 | all **04:00** UTC |
| earlier90 | 46 / $98.93 | 48 | 2 | +$1.77 | all **04:00** UTC |

Added fills enter at **04:00 UTC** (next 4h bar after a 20:00 signal under confirm T→T+1→T+2), not at 20:00 — expected with bullish_close confirm. New path is mostly winners on OOS (oos45 2/2; oos60 4/5).

## Decision
No further config change. Keep `BLOCKED_HOURS=[13]`. Wait for first live paper in-band fill under post-promote baseline.

## Code / artifacts
- `scripts/edge-stack-stress-adx15-9045.ts` updated to TG[13]
- `scripts/edge-hour20-trade-delta-9045.ts`
