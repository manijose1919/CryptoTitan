# 2026-10-23 overnight — Promote UP under full quality stack

## Soak
- `:3137` paper; open 0; cohort 0; ~41923s suspend → WS reconnect + Watchdog benign skip.
- Regimes: DOWN/SIDEWAYS / AVAX STRONG_DOWN (no STRONG_UP); F&G ~56 Neutral.
- mode=paper; `V2_LIVE_CONFIRMED=no`; shorts off; DCA sim; GUI 200.

## Ask
Does UP + full promote stack (confirm+ADX20+chase0.85+conf0.60+vol0.20+tk4+no_overnight) clear fee-aware dual-split + longer windows? Prior 2026-10-05 ADX-parity rollback was under a weaker package.

## Results (static weights)

### Dual-split
| variant | 90/45 earlier | 90/45 OOS | 60/60 earlier | 60/60 OOS | dual |
|---|---|---|---|---|---|
| STRONG_UP only | n=17 PF7.98 +$54.28 | n=10 PF2.48 +$15.79 | n=10 PF4.23 +$25.20 | n=16 PF2.88 +$30.30 | **PASS** |
| **+UP** | n=33 PF3.76 +$71.27 | n=14 PF1.77 +$15.37 | n=18 PF4.23 +$38.94 | n=25 PF1.94 +$31.92 | **PASS** |

UP segment: earlier strongly positive; OOS45 UP n=4 −$0.51 (thin); OOS60 UP n=9 +$1.58.

### Longer stress (+UP)
| split | earlier | OOS | oos UP | pass |
|---|---|---|---|---|
| 90/45 | n=33 PF3.76 | n=14 PF1.77 | n=4 −$0.51 | **PASS** |
| 60/60 | n=18 PF4.23 | n=25 PF1.94 | n=9 +$1.58 | **PASS** |
| 120/60 | n=28 PF2.14 | n=25 PF1.94 | n=9 +$1.58 | **PASS** |
| 150/75 | n=26 PF2.09 | n=28 PF2.02 | n=11 +$2.03 | **PASS** |

`allPass=true`.

## Paper changes
- `V2_CONFIG.ALLOWED_REGIMES`: `['STRONG_UP']` → `['STRONG_UP', 'UP']`
- UP remains **4h-only** (`REGIME_TIMEFRAME_RESTRICT`)
- **MOMENTUM stays STRONG_UP-only** (own `MOMENTUM_CONFIG.ALLOWED_REGIMES`)
- multiStrategy TREND gains `MIN_SIGNAL_VOLUME_RATIO` parity with live

## Decision
**Promote** UP under the full quality stack. Stats baseline reset on restart. Rollback: STRONG_UP-only if soak UP fills show fee-drag / OOS-like thin losses.

## Code / artifacts
- `scripts/edge-up-promote-stack-9045.ts`, `scripts/edge-up-promote-stress-9045.ts`
