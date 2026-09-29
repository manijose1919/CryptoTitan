# 2026-09-29 — TREND entry/regime ablations under exit parity (no promote)

## Question
After exit knobs failed the fee-aware bar, do entry/regime single-knob changes clear it?

## Protocol
- Same as `docs/reviews/2026-09-29-exit-parity-ablation.md`
- Runner: `scripts/edge-entry-regime-ablation.ts`
- Artifact: `/opt/cursor/artifacts/edge-entry-regime-ablation.json`
- Bar: OOS PF > 1.1 **and** OOS net > 0 **and** earlier PF ≥ 0.9

## Results (OOS45)

| Ablation | OOS PF | OOS net | Earlier PF | Pass | Notes |
|---|---|---|---|---|---|
| baseline | 0.498 | −$74.23 | 0.670 | no | Paper gates |
| score_65 | 0.498 | −$74.23 | 0.670 | no | **Non-binding** — identical trade set |
| conf_70 | 0.420 | −$48.51 | 0.298 | no | Fewer trades; earlier collapses |
| min_exp_1pct | 0.498 | −$74.23 | 0.670 | no | Non-binding on this sample |
| vol_1m | 0.498 | −$74.23 | 0.670 | no | Non-binding on this sample |
| mom_off | 0.481 | −$73.74 | 0.526 | no | Slightly worse |
| allow_UP | 0.686 | −$82.03 | **0.233** | no | Loosening hurts earlier half |

**anyPromote = false.**

## Decision
- Keep `STRONG_UP` only — do **not** add `UP`.
- Threshold tweaks (score 65, vol $1M, min expected 1%) are currently non-discriminating; stop sweeping them.
- Next research should attack **signal quality / avgLoss structure** (why avg loss ≈ 2× avg win under parity), not more gate-threshold mining.

## Paper soak (same cycle)
- `:3137` recovered from post-wake stale; open 0; closed 4; net −$52.60; no new fills.
- GUI `/monitor` 200.
