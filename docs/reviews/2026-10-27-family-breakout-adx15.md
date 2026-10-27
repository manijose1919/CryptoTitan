# 2026-10-27 overnight — family bake-off + BREAKOUT ADX15 refresh (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72; F&G ~57 Neutral.
- BNBUSD **UP** ATR% ~0.97–1.01 &lt; min 1.5; rest DOWN/SIDEWAYS/STRONG_DOWN.
- ~41671–41698s suspend → WS + dual Watchdog recovery; mode=paper; `V2_LIVE_CONFIRMED=no`.
- Bearish: shorts off; DCA sim-only; GUI 200.

## Family bake-off (dual-split bar, multi-strategy engine)

Locked contestants — no ticker cherry-pick. Bar: dual 90/45+60/60 OOS PF≥1.1 & net>0 & earlier PF≥0.9 & n≥10.

| family | dual | Σnet | note |
|---|---|---|---|
| TREND STRONG_UP 4h | FAIL | −$373 | raw engine (no confirm/vol/chase stack) |
| TREND SU+UP 4h | FAIL | −$959 | raw engine |
| MOMENTUM STRONG_UP 4h | FAIL | −$70 | |
| BREAKOUT SU+UP 4h | FAIL | −$37 | n-starve |
| MR SIDEWAYS 1h | FAIL | −$31 | earlier n=0 |

`anyDualPass=false`. Raw TREND without the paper quality stack is **not** a counterexample to the locked promote package (that package still dual-clears — see prior stress).

## BREAKOUT re-baseline (ADX floor now 15)

| ablation | earlier n/PF | oos n/PF | pass |
|---|---|---|---|
| paper-ish SU+UP + ADX, no confirm | 28 / 0.47 | 11 / 0.32 | no |
| SU + ADX | 16 / 0.50 | 11 / 0.32 | no |
| SU + ADX + confirm | 6 / 0.64 | 5 / 0.02 | no |
| SU + ADX + confirm + chase | 1 / 0 | 3 / 0 | no |
| SU+UP + ADX + confirm + chase | 1 / 0 | 3 / 0 | no |
| SU+UP no ADX | 29 / 0.54 | 12 / 0.26 | no |

`anyPromote=false`. ADX15 does not rescue BREAKOUT under CAD fees.

## Decision
No trading-config change. Keep TREND/MOMENTUM quality stack; do not enable BREAKOUT/MR. Alternate-family path remains closed.

## Code / artifacts
- `scripts/edge-family-bakeoff-adx15-9045.ts`
- re-ran `scripts/edge-breakout-adx-confirm-9045.ts` (now ADX15 via `TREND_MIN`)
