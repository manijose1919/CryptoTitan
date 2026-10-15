# 2026-10-15 midday — TREND score live/backtest parity

## Soak (:3137)
- ~41708s suspend: V2 benign skip; WS Dead→Connected clean. Deep STRONG_DOWN; open 0; F&G 46 Neutral.
- mode=paper; shorts off / DCA sim; GUI 200. WS health age fields OK.

## Bug
`backtestEngine` TREND scoring drifted from live `generateSignals`:
- Backtest used **BB%B > 0.80** cliff (`6+(pctB-0.80)*120`)
- Live uses **BB%B > 0.95** only, plus **MACD hist / SR>0.85 / TC≥80** penalties

Research baselines were not paper-faithful (over-penalizing mild BB stretch; omitting live gates).

## Fix
Shared `applyLongTrendScoreAdjustments` used by live + backtest + funnel. Unit tests lock BB>0.95 formula and no-penalty at 0.90.

## Re-baseline (locked stack 90/45)
| Window | Before (stale BB>0.80) | After (live parity) |
|---|---|---|
| earlier90 | n=6 PF 0.455 −$10.94 | n=7 PF 0.466 −$10.72 |
| oos45 | n=3 PF 1.35 +$1.73 | n=2 PF **0.37** −$3.08 |

**Still no promote.** Parity makes OOS look weaker on this calendar — prior OOS lift was partly an artifact of the wrong BB cliff / missing live penalties. Funnel entryEligible earlier 7 / oos 2.

## Decision
No trading-config change. Paper live path behavior unchanged (refactor only). Keep locked gates; treat prior backtest OOS figures as superseded for promote decisions.
