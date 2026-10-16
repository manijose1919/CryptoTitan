# 2026-10-16 — Dual-watchdog kicks; post-parity autopsy

## Soak (:3137)
- ~41630s suspend: **V2 + Bearish Watchdog kick** (not just benign skip); WS Dead→Connected clean (no 1006 cascade).
- mode=paper; open 0; cohort 0; all DOWN/STRONG_DOWN; F&G ~56 Neutral.
- Shorts off / DCA sim; GUI 200; WS health age fields OK.

## Code
- `multiStrategy/entryDetectors.detectTrend` now uses shared `applyLongTrendScoreAdjustments` (was UP +5 and missing TC/maturity). Paper path unchanged.

## Post-parity trade autopsy (90/45, locked stack)
| Window | n | net | byExit |
|---|---|---|---|
| earlier90 | 7 | −$10.72 | time_kill×2 (−$5.18), stop×1 (−$9.48 BNB), trailing×4 (+$3.95 incl. ADA −$5.38) |
| oos45 | 1 | +$1.81 | trailing×1 (LINK) |

Earlier drag unchanged in structure (fee-bleed kills + BNB stop). Calendar roll left OOS at **n=1** — promote bar unreachable until STRONG_UP in-band sample returns. Conf-soften / tighten already failed under this stack.

## Decision
No trading-config change. Keep locked gates; soak through risk-off.
