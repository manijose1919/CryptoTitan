# 2026-10-25 midday — ATR-rise cooldown diag + chase neighborhood (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72 history; F&G ~47 Neutral.
- BNBUSD **UP** ATR% ~0.99 &lt; min 1.5 (multi-day); rest DOWN/STRONG_DOWN.
- ~41551s suspend → WS reconnect + dual Watchdog kick; mode=paper; `V2_LIVE_CONFIRMED=no`.

## ATR-rise cooldown (low-ATR UP → into [1.5, 2.8])

| window | UP+ADX | inBand | lowMiss | rise≤12 | confirmEligible≤12 |
|---|---|---|---|---|---|
| earlier90 | 1747 | 844 | 707 | 115 (16%) | 18 |
| oos45 | 715 | 335 | 214 | 9 (4%) | **0** |
| earlier60 | 1139 | 425 | 555 | 97 (18%) | 6 |
| oos60 | 1029 | 519 | 313 | 31 (10%) | 13 |

**Shelve** delayed-entry-on-ATR-rise — OOS45 confirm-eligible after rise is zero. Do not lower minATR (reconfirmed overnight).

## Chase under UP+ADX15+MAX2.8

| variant | dual | Σnet |
|---|---|---|
| chase 0.80 | PASS | $204.6 |
| **paper 0.85** | **PASS** | **$211.3** |
| chase 0.90 | PASS | $185.5 |
| chase 0.95 | PASS | $197.7 |
| chase off | PASS | $224.2 |

Looser chase (0.90/0.95) hurts Σnet. Chase-off lifts Σnet but removes a quality gate — **not promoted** (keep 0.85).

## Decision
No trading-config change. Keep minATR 1.5 / chase 0.85. Wait for in-band UP/STRONG_UP.

## Code / artifacts
- `scripts/edge-atr-rise-diag-9045.ts`, `scripts/edge-chase-adx15-stack-9045.ts`
