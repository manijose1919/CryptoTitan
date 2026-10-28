# 2026-10-28 overnight — promote TimeGate drop hour 20

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72; F&G ~44 Neutral.
- BNBUSD **UP** ATR% ~0.97 &lt; min 1.5; peers SIDEWAYS/DOWN.
- ~41699–41709s suspend → WS + dual Watchdog; mode=paper; `V2_LIVE_CONFIRMED=no`.

## Neighborhood (locked ADX15 stack)

| variant | dual | Σnet |
|---|---|---|
| paper [13,20]+Fri | PASS | $160.4 |
| tg off | PASS | $166.8 |
| hours empty + Fri | PASS | $191.0 |
| **hour 13 + Fri** | **PASS** | **$191.0** |
| hour 20 + Fri | PASS | $160.4 |
| [13,20] no Fri | PASS | $136.6 |
| overnight 0–7 back | **FAIL** | $69.9 (n-starve) |

Gain vs paper is entirely from dropping hour 20 (hour 13 alone ≈ hours-empty).

## Stress (paper vs drop20)

| split | paper | drop hour 20 |
|---|---|---|
| 90/45 | PASS | PASS |
| 60/60 | PASS | PASS |
| 120/60 | PASS | PASS |
| 150/75 | PASS | PASS |
| Σnet (all windows) | $342.9 | **$397.3** |

`promoteCandidate=true` — dual + longer stress all PASS with +$54 Σnet.

## Decision
**Promoted** `TIME_GATE_CONFIG.BLOCKED_HOURS`: `[13, 20]` → `[13]`. Keep Friday block. Do not re-block overnight 0–7.

## Code / artifacts
- `v2/pipeline/timeGate.ts`, `timeGate.scoreBoost.test.ts`
- `scripts/edge-timegate-adx15-stack-9045.ts`, `edge-timegate-hour20-stress-9045.ts`
