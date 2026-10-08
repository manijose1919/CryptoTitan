# 2026-10-08 — Exit knobs under ADX20+confirm (no promote)

## Context
Prior exit ablations (2026-09-29) predate confirm+ADX20. Under the live stack, paper_live earlier drag includes time_kill / stop_loss while OOS is all trailing (+$18.88 PF 4.85).

## Results (`edge-exit-adx20-confirm-9045`)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper live | 6 / 0.46 / −$10.94 | 7 / 4.85 / +$18.88 | no |
| timeKillBars→3 / →4 | 6 / 0.34 / −$17.46 | 7 / 4.85 | no — longer leash → larger stop losses |
| timeKillMinMove→1.0% | 6 / 0.41 / −$13.18 | 7 / 4.85 | no |
| timeKillMinMove→0.5% | 6 / 0.34 / −$17.46 | 7 / 4.85 | no |
| trailGiveback→0.025 | 6 / 0.46 / −$10.87 | 7 / 4.90 | no |
| trailGiveback→0.02 | 6 / 0.46 / −$10.80 | 7 / **4.94** | no (tiny OOS lift) |
| slAtrMult→1.2 | 6 / 0.31 / −$20.09 | 7 / 4.85 | no — worse |

**anyPromote = false.** n stays 6 (exits cannot clear n≥10). Longer time-kill converts fee-bleed kills into deeper stops.

## Decision
Keep paper TREND exits. No exit-config promote. Entry-loosen already shelved (60/60 n ceiling). Soak continues on locked stack.
