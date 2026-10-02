# 2026-10-02 — UP + confirm + minATR: first robust bar clear (paper wire pending)

## Paper soak
- `:3137` paper, stale=false, open 0, trades 4, pnl −$52.60.
- **All 10 HTF regimes = UP**, none STRONG_UP → scanner rejects everything (paper dark).
- Bearish safe; timer ok until 2026-10-05.

## Question
Can allowing UP **only when paired with** confirm+MAX_ATR+chase(+minATR) clear robust 90/45 with earlier n≥10? (Bare allow_UP previously failed earlier PF 0.23 / 0.35.)

## Protocol
- Runner: `scripts/edge-up-confirm-9045.ts` + `scripts/edge-up-confirm-promote-stress.ts`
- Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10

## Ablation results (90/45)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| STRONG_UP baseline | 29 / 0.51 / −$33.54 | 38 / 0.51 / −$69.54 | no |
| STRONG_UP + confirm stack | 8 / 0.668 / −$6.56 | 15 / 3.74 / +$29.89 | no (n) |
| UP+STRONG_UP bare | 97 / 0.346 / −$187.81 | 96 / 0.69 / −$90.20 | no |
| UP+STRONG_UP + confirm | 33 / 0.474 / −$49.04 | 30 / 1.86 / +$38.88 | no |
| **UP+STRONG_UP + confirm + minATR≥1.5** | **20 / 1.199 / +$6.79** | **21 / 1.947 / +$33.41** | **yes** |
| UP+STRONG_UP + confirm only (MAX8) | 35 / 0.488 / −$51.22 | 35 / 1.27 / +$19.86 | no |

**anyPromote = true** (numeric). MAX_ATR=2.5 is required (confirm-only with MAX8 fails earlier).

## Stress splits (winning stack)

| Split | Earlier | OOS | Pass |
|---|---|---|---|
| 90/45 | n=20 PF=1.199 net=+$6.79 | n=21 PF=1.947 net=+$33.41 | **yes** |
| 60/60 | n=18 PF=1.455 net=+$12.71 | n=23 PF=1.633 net=+$27.87 | **yes** |
| 45/45 | n=4 PF=∞ (4/4 wins) net=+$15.09 | n=21 PF=1.947 net=+$33.41 | no (n&lt;10 only) |
| full90 | n=28 PF=1.616 net=+$33.20 | — | positive |

45/45 earlier miss is **sample-size only** (all winners), not negative expectancy.

## Candidate package (must ship together)
1. `ALLOWED_REGIMES: ['STRONG_UP', 'UP']` (loosening — evidence-backed only with #2–4)
2. `MAX_ATR_PERCENT: 2.5` (tightening)
3. `confirmMode: bullish_close` (T+2 entry — needs pending-signal plumbing in paper engine)
4. `maxSignalCloseLocation: 0.8` + `minSignalAtrPercent: 1.5`

## Decision
**Do not wire paper this cycle.** Robust 90/45 + 60/60 clear, but live confirm requires pending-entry state across 4h bars — shipping UP without confirm would match failing ablations.

**Next cycle:** implement paper pending-confirm + chase/minATR gates + MAX_ATR=2.5 + allow UP as one changelog’d package, with unit tests for pending-signal lifecycle; then soak on `:3137`.
