# 2026-10-17 midday — Dual watchdog kicks; short SL ablation (no promote)

## Soak (:3137)
- ~41810s suspend: **V2 + Bearish Watchdog kick**; WS Dead→Connected clean.
- mode=paper; open 0; cohort 0; deep DOWN/STRONG_DOWN; F&G ~50 Neutral.
- Shorts off / DCA sim; GUI 200. Timer OK through ~2026-10-23.

## Short SL ablation (`edge-short-exit-ablation-9045`)
Same STRONG_DOWN+confirm+ADX+ATR stack; vary `SHORT_STOP_LOSS_ATR_MULT` only.

| SL ATR | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| **1.5 (paper)** | 20 / 1.30 / +$11.21 | 12 / 0.72 / −$9.35 | no |
| 1.2 | 20 / 1.47 / +$15.60 | 12 / 0.86 / −$3.86 | no |
| 1.0 | 20 / 1.48 / +$15.86 | 12 / **0.99** / −$0.21 | no |

**anyPromote = false.** Tighter stops shrink OOS stop drag toward breakeven but never clear PF>1.1 / net>0. Earlier stays strong — classic IS/OOS asymmetry; do not enable shorts.

## Decision
No trading-config change. `SHORTS_ENABLED` remains false. Long locked stack unchanged.
