# 2026-09-30 — Entry-bar quality filters for holdBars=0 stops (no promote)

## Question
Can rejecting chase / chaotic signal bars cut same-bar stop-outs and clear the fee-aware promotion bar?

## Protocol
- CAD10, STRONG_UP, 4h, next-bar open, STRATEGY_EXIT parity, 0.52% RT, 5bps, pessimistic
- Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9
- Runner: `scripts/edge-entry-bar-quality.ts`
- Helper: `passesEntryBarQuality` in `v2/backtest/backtestEngine.ts` (optional `BacktestConfig.entryFilters`)

## Results

| Ablation | OOS PF | OOS net | OOS zeroHoldSL | Earlier PF | Pass |
|---|---|---|---|---|---|
| baseline | 0.484 | −$76.28 | 4 | 0.256 | no |
| no_chase closeLoc≤0.80 | 0.478 | −$70.80 | 4 | 0.393 | no |
| no_wide range/ATR≤2.0 | 0.484 | −$76.28 | 4 | 0.256 | no (non-binding) |
| quality combo | 0.478 | −$70.80 | 4 | 0.393 | no |
| MAX_ATR=2.5 | 0.945 | −$3.59 | 1 | 0.256 | no |
| **MAX_ATR=2.5 + quality** | **0.971** | −$1.61 | 1 | **0.393** | no |

**anyPromote = false.**

## Notes
- Chase filter helps the *earlier* half (PF 0.256→0.393, earlier zeroHoldSL 1→0) but does **not** remove OOS same-bar stops (still 4).
- Wide-bar filter is non-binding on this sample.
- Best combo so far under parity: MAX_ATR=2.5 + chase — nearly flat OOS, still fails net>0 and earlier≥0.9.
- Paper runtime unchanged (entryFilters research-only; not wired into live scanner).

## Decision
Do not promote. Keep soaking. Next candidates only if pre-registered: (a) pullback confirmation bar, (b) longer earlier window that contains high-ATR mass for a fair MAX_ATR re-test.

## Paper soak (same cycle)
- `:3137` paper, stale=false, open 0, trades 4, pnl −$52.60, no STRONG_UP passes, no new fills.
