# 2026-10-16 midday — Dual watchdog; static research weights; timer renew

## Soak (:3137)
- ~41660s suspend: **V2 + Bearish Watchdog kick**; WS Dead→Connected clean. Mid-session 1006 recovered cleanly.
- mode=paper; open 0; cohort 0; regimes easing DOWN→SIDEWAYS (still no STRONG_UP). F&G ~58 Neutral.
- Shorts off / DCA sim; GUI 200.

## Scorecard audit
- Paper `:3137` scorecard: 11 signals, all **inconclusive** (n=6 < `MIN_TRADES_FOR_SCORING=20`).
- Research `DATA_DIR` scorecard: **0 rows**.
- Adaptive weights currently match defaults on both — no live/research drift **yet**.

## Hardening
- `setSignalWeightMode('static'|'adaptive')` + `V2_SIGNAL_WEIGHT_MODE=static`.
- Locked baseline / autopsy / funnel force **static** so future adaptive pruning on a research DB cannot silently diverge from paper (while paper remains inconclusive).
- Live paper stays **adaptive** (default).

## Timer
Renewed `cryptotitan-paper-3137-12h` (43200s) — expires ~2026-10-23 (was ~2026-10-18).

## Decision
No trading-config change. Keep locked stack through risk-off / SIDEWAYS.
