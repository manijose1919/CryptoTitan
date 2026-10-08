# 2026-10-08 — TimeGate overnight unblock: promote rejected

## Context
Funnel showed timeGate as the largest post-STRONG_UP+ADX drop (−158 earlier bars). Ablated overnight/Friday hard-blocks under ADX20+confirmMomentum stack.

## Ablation 90/45 (`edge-timegate-adx20-9045`)

| Variant | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper live (control) | 6 / 0.46 / −$10.94 | 7 / 4.85 / +$18.88 | no |
| timegate_off | 14 / 1.14 / +$3.58 | 12 / 3.76 / +$44.84 | **yes** |
| no_overnight (hours=[13,20], Friday kept) | 13 / 1.18 / +$4.44 | 11 / 2.53 / +$24.56 | **yes** |
| no_friday | 6 / 0.46 / −$10.94 | 7 / 4.85 | no (= control) |
| hours_13_20_only (drop overnight+Friday) | 13 / 1.18 / +$4.44 | 11 / 2.53 | **yes** (= no_overnight) |

Friday block is irrelevant under this stack. Overnight 0–7 UTC is the binding TimeGate cut.

## Stress 60/60 (`edge-timegate-overnight-stress`)

Candidate: `BLOCKED_HOURS=[13,20]` (drop 0–7); Friday kept; full ADX20+confirm stack.

| Split | Earlier | OOS | Pass |
|---|---|---|---|
| 90/45 | n=13 PF=1.18 net=+$4.44 | n=11 PF=2.53 net=+$24.56 | yes |
| **60/60** | **n=6** PF=3.21 net=+$15.25 | n=17 PF=3.97 net=+$47.89 | **no** (earlier n&lt;10) |

## Decision
**Do not promote** overnight TimeGate unblock to paper. PF/net look strong but earlier n fails the robust bar on 60/60. Keep live `BLOCKED_HOURS=[0..7,13,20]` + Friday.

Research scripts kept for replay; no trading-config change.
