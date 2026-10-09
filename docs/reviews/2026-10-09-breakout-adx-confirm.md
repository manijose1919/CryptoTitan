# 2026-10-09 — BREAKOUT ADX + confirm re-baseline (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; market fully risk-off (DOWN/STRONG_DOWN).
- Watchdog after suspend OK. Shipped `lastEvalAt` on bearish status (was duration-only `lastEvalTime`).

## Question
Does BREAKOUT under paper ADX≥20 (± bullish_close confirm / chase) clear fee-aware 90/45?

## Results (`edge-breakout-adx-confirm-9045`)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper-ish SU+UP + ADX, no confirm | 14 / 0.74 / −$5.68 | 12 / 0.11 / −$13.43 | no |
| STRONG_UP + ADX, no confirm | 10 / 0.82 / −$3.04 | 11 / 0.13 / −$11.33 | no |
| SU + ADX + confirm | 4 / 1.13 / +$0.52 | 6 / 0.03 / −$10.41 | no |
| SU + ADX + confirm + chase≤0.80 | 1 / 0 | 3 / 0 | no |
| SU+UP + ADX + confirm + chase | 1 / 0 | 3 / 0 | no |
| SU+UP no ADX (pre-parity) | 22 / 0.83 / −$5.39 | 12 / 0.11 / −$13.43 | no |

**anyPromote = false.** OOS deeply negative under every variant. Confirm lifts earlier PF slightly but starves n and does not fix OOS.

## Decision
Do not enable BREAKOUT confirm or loosen BREAKOUT regimes. Keep ADX gate on BREAKOUT (desync fix). TREND/MOMENTUM locked stack unchanged. Alternate-family path remains closed under CAD fees.
