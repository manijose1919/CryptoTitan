# 2026-09-30 — Loss-structure autopsy + MAX_ATR ceiling (no promote)

## Question
Why is avgLoss ≈ 2× avgWin under fee-aware paper exit parity, and does capping extreme ATR fix OOS?

## Loss structure (OOS45, CAD10, STRONG_UP, 4h)

| Exit bucket | n | WR | Net | Avg PnL | Notes |
|---|---|---|---|---|---|
| **stop_loss** | 11 | 0% | **−$111.98** | −$10.18 | avgR ≈ −1.02; med hold 1 bar; many **holdBars=0** |
| trailing (all) | 26 | 77% | **+$36.89** | — | Net positive; includes BE/QK-raised stops labeled “trailing” |
| time_kill | 2 | 50% | −$1.17 | — | Minor |

- Wins capture ≈ **0.57R**; stop-outs take ≈ **1.0R** + fees.
- Score/confidence of stop-outs ≈ trail-wins (~69–70) — **not filterable by score**.
- ATR band **2.5–4%**: n=13, net **−$58**, avgLoss −$10.83 (largest band drag).
- Worst stops: peakPct≈0, holdBars=0 — next-bar entry immediately stopped in the entry bar.

Artifacts: `/opt/cursor/artifacts/edge-loss-structure.json`, runner `scripts/edge-loss-structure.ts`.

## MAX_ATR ceiling ablation (pre-registered)

Hypothesis: `MAX_ATR_PERCENT` 8 → 2.5 refuses the death-zone band.

| Variant | OOS PF | OOS net | OOS WR | Earlier PF | Pass |
|---|---|---|---|---|---|
| baseline max=8 | 0.484 | −$76.28 | 53.8% | 0.256 | no |
| **max=2.5** | **0.945** | −$3.59 | **63.0%** | 0.256 | no |
| max=3.0 | 0.568 | −$54.37 | 56.8% | 0.256 | no |

Bar (OOS PF>1.1, net>0, earlier PF≥0.9): **FAIL** — earlier half unchanged (ceiling did not bind there); OOS nearly flat but still slightly negative.

Artifact: `/opt/cursor/artifacts/edge-max-atr-ceiling.json`, runner `scripts/edge-max-atr-ceiling.ts`.

## Decision
- **Do not promote** MAX_ATR 2.5 yet (fails earlier-half gate and OOS net≤0).
- Trailing is not the primary bleed — **immediate full stop-outs** are.
- Most promising *directional* lever seen so far under parity: refuse ATR≳2.5 entries. Re-test when earlier half has high-ATR mass, or combine with a second pre-registered knob — never alone from OOS cherry-picking.

## Paper soak (same cycle)
- `:3137` recovered from stale; open 0; trades 4; pnl −$52.60; no new fills; no STRONG_UP passes after wake.
