# 2026-10-07 — Feature probes under ADX20 + MOMENTUM confirm

## Soak
- `:3137` paper; contaminated AVAXUSD MOMENTUM still open (~12h, mark ~$11.62, stop ~$11.54).
- Watchdog kicks after suspend; ADX block holds (no MOMENTUM re-fill).
- Fear & Greed `lastFetchTime` ~11h wall-stale after suspend — fixed separately (wall-clock refresh).

## Question
Under full paper stack (STRONG_UP + confirm + chase≤0.80 + MAX2.5 + minATR1.5 + ADX≥20 + **confirmMomentum**), do range / confirm-mode / score / trail / tighter-chase knobs clear robust 90/45?

## Results (`edge-adx20-confirmmom-features-9045`)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper live (MOM confirm) | 6 / 0.58 / −$6.52 | 7 / 4.85 / +$18.88 | no |
| maxSignalRangeAtr≤2.0 | 4 / 0.87 / −$1.33 | 7 / 4.85 / +$18.88 | no |
| maxSignalRangeAtr≤2.5 | 6 / 0.58 / −$6.52 | 7 / 4.85 | no |
| bullish_and_above | 6 / 0.58 / −$6.52 | 7 / 4.85 | no |
| score 55 / 65 | 6 / 0.58 (identical) | 7 / 4.85 | no |
| trailGiveback 0.03→0.02 | 6 / 0.59 / −$6.38 | 7 / 4.94 / +$19.31 | no |
| trailActivate →0.018 | 6 / 0.37 / −$14.87 | 7 / 4.82 | no |
| chase≤0.75 | 5 / **0.89** / −$1.13 | 7 / 4.85 | no (n + PF) |

**anyPromote = false.**

## Decision
No paper trading-config change. Closest miss: chase≤0.75 (earlier PF 0.89, n=5). Do not tighten chase further without n≥10. Score not binding. Tighter trail activate hurts earlier.

Keep: STRONG_UP + confirm + chase≤0.80 + MAX2.5 + minATR1.5 + ADX≥20 + MOMENTUM confirm.
