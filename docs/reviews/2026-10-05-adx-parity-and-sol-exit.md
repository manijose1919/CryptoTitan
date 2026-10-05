# 2026-10-05 — ADX paper/backtest parity + SOL artifact exit

## Paper soak
- mode=paper, stale=false after resume; SHORT=off; DCA=sim-only.
- **Watchdog proven:** `Watchdog kick: lastLoopAt age 42220s — running loop` after ~11.7h suspend.
- **SOLUSD artifact trade closed:** entry $119.30 → exit $121.36 trailing, **+$0.86** (contaminated — skip-bar entry; do not use for promote evidence).
- Cohort post-baseline: n=1, WR=100%, net=+$0.86.
- Scanner: ADA/LINK/AVAX PASS (UP + ATR in band) but **no TREND signals**.

## Diagnostic (`scripts/diag-pass-no-signal.ts`)
| Ticker | Scan | ADX | Block |
|---|---|---|---|
| ADAUSD | PASS | 17.2 | ADX &lt; 20 |
| LINKUSD | PASS | 14.0 | ADX &lt; 20 |
| AVAXUSD | PASS | 12.7 | ADX &lt; 20 |
| majors | FAIL ATR/regime | — | scanner |

Would-signal set empty. Binding gate after scan PASS is **paper ADX≥20** (`ADX_THRESHOLDS.TREND_MIN`).

## Question
Promote-package fee-aware backtests omitted the paper ADX gate. With `minAdx=20` (paper parity), does the package still clear robust 90/45?

## Protocol
- Runner: `scripts/edge-adx-parity-9045.ts`
- Backtest gained optional `entryFilters.minAdx` (unset = legacy no-ADX path)
- Fixed package: UP+STRONG_UP, MAX_ATR=2.5, bullish_close, chase≤0.80, minATR≥1.5

## Results (90/45)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| promote (no ADX) | 20 / 1.199 / +$6.79* | 20 / 2.42 / +$44.53 | **yes** |
| **promote + ADX≥20 (paper)** | **12 / 0.714 / neg** | **12 / 0.873 / −$3.70** | **no** |
| promote + ADX≥15 | 17 / 0.881 / — | 18 / 2.019 / +$29.86 | no (earlier PF) |

\*earlier figures may shift slightly with end-date roll; direction unchanged.

## Decision
1. **Keep paper ADX≥20** — do not loosen; it is the live risk gate and ADX15 still fails the earlier-PF bar.
2. Treat prior promote-package 90/45 clear as **optimistic vs paper** until a stack clears with `minAdx=20`.
3. Future research must set `entryFilters.minAdx: ADX_THRESHOLDS.TREND_MIN` for paper-parity claims.
4. Contaminated SOL +$0.86 is soak ops success (trail worked) but not package validation.
