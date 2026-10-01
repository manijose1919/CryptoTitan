# 2026-10-01 — Confirmation-bar entry (fragile bar pass; no paper promote)

## Question
Does waiting one confirmation bar after the signal (enter at T+2 open), optionally stacked with MAX_ATR=2.5 ± chase, clear the fee-aware promotion bar?

## Protocol
- CAD10, STRONG_UP, 4h, 0.52% RT, 5bps, pessimistic, STRATEGY_EXIT parity
- `confirmMode`: signal → confirm bar → entry at following open
- Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9
- Runner: `scripts/edge-confirm-bar.ts`
- Helpers: `passesConfirmBar` + optional `entryFilters.confirmMode`

## Results

| Ablation | OOS n | OOS PF | OOS net | OOS zHoldSL | Earlier n | Earlier PF | Pass |
|---|---|---|---|---|---|---|---|
| baseline | 39 | 0.484 | −$76.29 | 4 | 16 | 0.211 | no |
| confirm bullish_close | 18 | 1.167 | +$6.44 | 0 | 7 | 0.800 | no |
| confirm close_above_signal | 19 | 1.298 | +$11.53 | 0 | 8 | 0.599 | no |
| bullish + chase≤0.80 | 17 | 1.065 | +$2.51 | 0 | 4 | 1.428 | no |
| MAX_ATR=2.5 only | 27 | 0.944 | −$3.60 | 1 | 16 | 0.211 | no |
| MAX_ATR=2.5 + bullish | 16 | 4.144 | +$34.29 | 0 | 7 | 0.800 | no |
| MAX_ATR=2.5 + above | 16 | 4.144 | +$34.29 | 0 | 8 | 0.599 | no |
| **MAX_ATR=2.5 + bullish + chase** | **15** | **3.783** | **+$30.35** | **0** | **4** | **1.428** | **yes*** |

\*Numeric bar met. **Earlier half has only 4 trades** — treat as fragile / provisional.

**anyPromote = true** (numeric), paper runtime **not** updated.

## Notes
- Confirmation alone zeros same-bar stop-outs and flips OOS net positive, but earlier PF stays &lt;0.9 (and full90 for confirm-only remains negative).
- MAX_ATR=2.5 + confirm drives strong OOS (PF≈4.1) but still fails earlier without chase.
- Chase is what lifts earlier PF≥0.9, at the cost of n=4 on the earlier window — too thin to trust for a runtime change.
- Full90 for the stacked pass: n=20, WR 75%, PF 1.845, net +$24.84, zeroHoldSL=0.

## Decision
**Do not promote to paper** yet. First numeric bar clear, but earlier-half sample is too small. Longer-window stress (below) shows the pass is **window-dependent**. Paper `MAX_ATR_PERCENT` stays 8; no confirmMode in live path.

## Longer-window stress (same candidate)

Runner: `scripts/edge-confirm-bar-longwindow.ts`

| Split | Earlier | OOS | Pass |
|---|---|---|---|
| 90d earlier / 45d OOS | n=8 PF=0.456 net=−$15.73 | n=15 PF=3.783 net=+$30.35 | **no** |
| 60d / 60d | n=7 PF=0.918 net=−$1.18 | n=15 PF=3.759 net=+$30.55 | yes (barely) |
| baseline 90/45 MAX_ATR=8 | n≈16-class drag | OOS PF=0.484 net=−$76.29 | no |

The 90/45 earlier half fails hard (PF 0.456). The 60/60 earlier PF 0.918 clears ≥0.9 with n=7 only. **Pass is not robust across window choice → still no paper promote.**

## Paper soak (same cycle)
- `:3137` paper, stale=false, open 0, trades 4, pnl −$52.60, no STRONG_UP passes, no new fills.
- Timer `cryptotitan-paper-3137-12h` ok until 2026-10-05.
