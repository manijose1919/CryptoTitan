# 2026-10-22 midday — Residual stop probe under vol≥0.20 stack

## Soak
- `:3137` paper; open 0; cohort 0; mode=paper; `V2_LIVE_CONFIRMED=no`.
- ~41564s suspend: WS Dead→reconnect; Watchdog benign skip; stale=false; GUI 200.
- Regimes: mostly DOWN/SIDEWAYS; AVAX STRONG_DOWN; F&G ~58 Neutral; shorts off; DCA sim.

## Dual-split refresh (paper_vol020)
Calendar-rolled full stack still **dual-clears**:

| split | earlier | OOS |
|---|---|---|
| 90/45 | n=15 PF**7.04** +$46.98 | n=10 PF**2.48** +$15.80 |
| 60/60 | n=10 PF**4.23** +$25.20 | n=16 PF**2.89** +$30.42 |

150d: n=34 WR82% +$62.69 PF2.75; stops=2 (BNB gone after vol floor).

## Residual stops (150d)
| ticker | pnl | vol | atr% | bb%B | conf | notes |
|---|---|---|---|---|---|---|
| ETHUSD | −$9.95 | 1.42 | 1.93 | 0.73 | 0.72 | not thin-vol |
| LINKUSD | −$11.21 | 0.88 | 2.44 | 0.71 | 0.66 | near MAX_ATR; not vol-gated |

No shared gateable feature (bb/SR/conf/vol).

## Ablations vs paper_vol020
| id | dual | Σ net (4 arms) | note |
|---|---|---|---|
| paper_vol020 | **PASS** | +$118.40 | baseline |
| chase_080 | fail | +$115.53 | earlier60 n=9 |
| max_atr_signal_22 | fail | +$86.06 | n-starve |
| sl_atr_12 | PASS | +$117.30 | earlier nets down |
| trail_gb_02 | PASS | +$121.13 | micro +$2.73; same stop count |

## Decision
**No trading-config change.** Keep chase0.85 / SL1.5 / trail giveback 0.03. trail_gb_02 is micro-positive but not material. Soak for STRONG_UP fills under current promote stack.

## Code / artifacts
- `scripts/edge-residual-stop-promote-9045.ts`
- `edge-residual-stop-promote-9045.json`
