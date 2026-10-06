# 2026-10-06 — MOMENTUM pending-confirm parity

## Question
Should paper wire TREND’s pending-confirm path for MOMENTUM (today next-bar)?

## Protocol
- Runner: `scripts/edge-mom-confirm-parity-9045.ts` (`confirmMomentum` opt-in)
- Stack: STRONG_UP + bullish_close + chase≤0.80 + MAX2.5 + minATR1.5 + ADX≥20
- Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10

## Results

| Variant | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| Paper today (MOM next-bar) | 5 / 0.86 / −$1.45 | 8 / 4.19 / +$15.63 | no |
| **MOM confirm T+2** | 5 / 0.86 / −$1.45 | **7 / 4.85 / +$18.87** | no |
| MOMENTUM off | 5 / 0.86 / −$1.45 | 5 / 2.38 / +$6.74 | no |

## Decision
**Wire MOMENTUM into pending-confirm** (hardening, not a promote).
- Earlier unchanged; OOS PF/net improve vs next-bar MOMENTUM.
- Closes the AVAX-style hole where MOMENTUM filled the same loop TREND was ADX-blocked (and skipped confirm).
- Still fails n≥10 — no regime/ATR loosen.

## Paper change
`tradeEngine`: `useConfirm` for `TREND` **and** `MOMENTUM`. BREAKOUT unchanged.
