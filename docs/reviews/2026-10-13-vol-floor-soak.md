# 2026-10-13 — Dual-watchdog #3 + volume-floor tighten (no promote)

## Soak (:3137)
- Overnight resume ~41925s + midday resume ~38847s: V2 + Bearish `Watchdog kick` both times; WS Connected→online **no 1006**.
- mode=paper; open 0; cohort 0; deep risk-off (mostly STRONG_DOWN); no STRONG_UP.
- F&G ~45 Neutral (positionMultiplier 1.0). Shorts stay off (2026-07 evidence).

## Feature autopsy (`edge-entry-feature-autopsy-9045`)
Under locked stack, earlier90 losers vs oos45 winners (tiny n):
- Standout: BNB stop_loss had **volume_ratio 0.16**; OOS winners ~0.47–0.54.
- Other gaps (td_score, trend_strength) overlap too much for a clean threshold.

## Volume floor ablation (`edge-vol-floor-9045`)
Research-only `entryFilters.minVolumeRatio` (+ unit tests). Not wired to paper.

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper (no floor) | 6 / 0.455 / −$10.94 | 3 / 1.35 / +$1.73 | no |
| vol≥0.3 | 4 / **0.809** / −$2.02 | 3 / 1.35 / +$1.73 | no |
| vol≥0.4 | 4 / 0.809 / −$2.02 | 3 / 1.35 | no |
| vol≥0.5 | 4 / 0.809 / −$2.02 | 2 / **0.98** / −$0.08 | no |

**anyPromote = false.** Floor 0.3 cuts BNB and lifts earlier PF but still &lt;0.9 and n=4; 0.5 hurts OOS.

## Decision
No paper config change. Keep locked stack. Volume floor remains a research knob only. Shorts stay disabled despite STRONG_DOWN regime.
