# 2026-10-24 midday — Exit knobs + short refresh under ADX15 stack (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72 history; F&G ~50 Neutral.
- Full risk-off: no UP/STRONG_UP (BNB SIDEWAYS; rest DOWN/STRONG_DOWN).
- ~41479s suspend → WS reconnect + Watchdog benign skip; mode=paper; `V2_LIVE_CONFIRMED=no`.
- Shorts off; DCA sim; GUI 200.

## Exit knobs (UP+ADX15+MAX2.8+vol0.20+tk4)

| variant | dual | Σnet | note |
|---|---|---|---|
| paper tk4 | **PASS** | $220.79 | baseline |
| tk5 / tk6 | PASS | $220.79 | identical to paper |
| **trail_gb 0.03→0.02** | PASS | **$226.46** | +$5.67 micro |
| trail_act 0.014→0.012 | PASS | $220.79 | identical |
| sl_atr 1.5→1.2 | PASS | $203.22 | worse Σnet |

**No promote** — trail tighten is micro-only (same class as 2026-10-22 residual probe).

## Short refresh (STRONG_DOWN + ADX15 + ATR1.5–2.8 + chase0.85)

| split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=44 PF1.45 +$37 | n=27 PF4.41 +$76 | **PASS** (improved vs 2026-10-17) |
| 60/60 | n=9 PF0.23 −$27 | n=46 PF0.87 −$17 | **FAIL** (earlier n&lt;10 + PF) |

`dualPass=false`. OOS60 stop_loss −$99 still dominates. **Shorts stay off.**

## Decision
No trading-config change. Paper stack unchanged (UP+ADX15+MAX2.8+…). Wait for risk-on UP/STRONG_UP fills under ADX15.

## Code / artifacts
- `scripts/edge-exit-adx15-stack-9045.ts`, `scripts/edge-short-refresh-adx15-9045.ts`
