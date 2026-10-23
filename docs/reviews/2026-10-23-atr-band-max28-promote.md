# 2026-10-23 midday — Promote MAX_ATR 2.5→2.8 under UP+full stack

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72 (history); F&G ~50 Neutral.
- Regimes: BNBUSD **UP** ATR% 0.84 &lt; min 1.5; DOTUSD **UP** ATR% 2.78 &gt; max 2.5; rest DOWN/STRONG_DOWN.
- ~41641s suspend → WS reconnect + Watchdog benign skip; mode=paper; `V2_LIVE_CONFIRMED=no`.

## Ask
Does ATR-band neighborhood (min 1.2/1.0 or max 2.6/2.8) dual-clear under UP+full promote stack without collapsing earlier PF?

## Dual-split (static weights)

| variant | 90/45 earlier | 90/45 OOS | 60/60 earlier | 60/60 OOS | dual | Σnet |
|---|---|---|---|---|---|---|
| paper 1.5–2.5 | n=33 PF3.76 | n=14 PF1.77 | n=18 PF4.23 | n=25 PF1.94 | **PASS** | $157.50 |
| min 1.2 | n=51 PF1.23 | n=20 PF2.43 | n=32 PF**0.90** | n=33 PF2.02 | fail | $84.22 |
| min 1.0 | n=59 PF1.03 | n=23 PF1.66 | n=39 PF**0.69** | n=35 PF1.80 | fail | $31.92 |
| max 2.6 | n=34 PF4.16 | n=14 PF1.77 | n=18 PF4.23 | n=27 PF1.60 | **PASS** | $162.91 |
| **max 2.8** | n=35 PF4.25 | n=18 PF2.87 | n=18 PF4.23 | n=30 PF1.85 | **PASS** | **$198.02** |
| min1.2+max2.8 | n=53 PF1.38 | n=24 PF3.52 | n=32 PF**0.90** | n=38 PF1.92 | fail | $124.75 |

minATR soften collapses earlier60 PF via UP drag — **keep min 1.5** (BNB soak stay blocked).

## Longer stress (minATR 1.5)

| split | paper max2.5 | max2.6 | **max2.8** |
|---|---|---|---|
| 90/45 | PASS | PASS | **PASS** (oos n=18 PF2.87 +$37) |
| 60/60 | PASS | PASS | **PASS** (oos n=30 PF1.85 +$38) |
| 120/60 | PASS | PASS | **PASS** |
| 150/75 | PASS | PASS | **PASS** (oos n=34 PF1.96 +$49) |

`max28AllPass=true`. Note: OOS60 UP segment −$4.91 (paper was +$1.58) but overall OOS nets/PFs improve; OOS45 UP +$3.66 (paper −$0.51).

## Paper changes
- `V2_CONFIG.MAX_ATR_PERCENT`: `2.5` → `2.8`
- `MIN_ATR_PERCENT` stays `1.5`

## Decision
**Promote** MAX_ATR 2.8 under UP+full quality stack. Not a DOT-only cherry-pick — CAD10 fee-aware dual+stress clear; prior 2026-10-05/06 keep-2.5 was under weaker packages. Rollback: MAX 2.5 if soak high-ATR fills show stop drag.

## Code / artifacts
- `scripts/edge-atr-band-up-promote-9045.ts`, `scripts/edge-atr-max-stress-9045.ts`
- `/tmp/cryptotitan-artifacts/edge-atr-band-up-promote-9045.json`, `edge-atr-max-stress-9045.json`
