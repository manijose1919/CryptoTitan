# 2026-09-29 — TREND exit ablations under backtestEngine parity (no promote)

## Question
With `backtestEngine` reading `STRATEGY_EXIT_CONFIGS.TREND` (bar×tf time-kill, fee-floored trail), do any single-knob exit changes clear the fee-aware promotion bar on CAD10?

## Protocol (pre-registered)
- Fills: next-bar open, pessimistic intra-bar, 0.52% RT taker, 5 bps/side
- Universe: CAD10, `STRONG_UP`, 4h
- Halves: earlier45 + oos45 (recent)
- Bar: OOS PF > 1.1 **and** OOS net > 0 **and** earlier PF ≥ 0.9
- Runner: `scripts/edge-exit-parity-ablation.ts`
- Artifact: `/opt/cursor/artifacts/edge-exit-parity-ablation.json`

## Results (OOS45)

| Ablation | OOS PF | OOS net | OOS WR | Earlier PF | Pass |
|---|---|---|---|---|---|
| baseline (paper exits) | 0.498 | −$74.23 | 53.8% | 0.670 | no |
| timeKillBars 2→3 | 0.499 | −$74.08 | 53.8% | 0.782 | no |
| timeKillBars 2→4 | 0.480 | −$79.99 | 53.8% | 1.104 | no |
| timeKillMinMove 0.7%→1.0% | 0.498 | −$74.23 | 53.8% | 0.670 | no |
| trail giveback 3%→5% | 0.481 | −$76.68 | 53.8% | 0.644 | no |
| trail activate →2.0% | 0.477 | −$77.58 | 51.3% | 0.620 | no |
| SL ATR 1.5→1.2 | **0.565** | −$56.73 | 53.8% | 0.718 | no |
| quickKillBars 1→2 | 0.550 | −$61.83 | 56.4% | 0.707 | no |

**anyPromote = false.**

## Notes
- Trail activate is fee-floored at `0.52% × 3 ≈ 1.56%`, so paper effective arm ≥ 1.56% even when `trailActivatePercent` is 1.4%.
- Best relative OOS was tighter SL (avgLoss −$7.24 vs baseline −$8.21) but still deeply negative — **not** a promotion.
- Parity baseline looks worse than older same-bar / non-parity README windows; do not cite those older PF≈1.0 figures for promotion under this protocol.

## Decision
Stay on current paper TREND exits. No config promote this cycle.

## Follow-ups
1. Entry-signal / regime path research (not more single-knob exit mining on a negative OOS baseline).
2. Keep soaking paper `:3137`; first wins will stress-test fill realism, not rewrite exits without a passing bar.
3. Optional: document effective trail floor (1.56%) in README operating posture.
