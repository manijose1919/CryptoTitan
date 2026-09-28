# Research note — ATR≥2.0 ablation + exit-knob desync — 2026-09-28

**Agent:** cursor cloud (paper-profit-dev)  
**Scope:** paper-only, CAD10 USD universe, fee-aware protocol  
**Verdict: no promote**

---

## Context

Paper :3137 closed 4 trades, all losses (DOT trailing −9.04, SOL stop −35.52 stale-WS already fixed, XRP stop −6.99, LINK time_kill −1.04). Prior family bake-off and locked ablation matrix (2026-09-22) found no promotion-bar pass under CAD fees.

## Experiment chosen

**Single knob:** `MIN_ATR_PERCENT` 1.0 → 2.0 (entry filter).

**Why this over other exit knobs:** Jul-23 live-band analysis (`docs/reviews/2026-07-23-atr-floor-and-shorts-analysis.md`) showed net edge concentrated in ATR 2–3%; the locked matrix already tested trail activate 2%, giveback 5%, SL 1.2×, score 65, ATR 1.5 — all failed. ATR≥2.0 was the highest-leverage *untested* filter runnable with existing `runBacktest` tooling in minutes.

**Protocol:** next-bar open, pessimistic bars, 0.52% RT taker, 5 bps/side, STRONG_UP, CAD10, 4h. Windows: earlier45 / oos45 / full90. Bar used here: OOS PF>1.1 AND net>0 AND earlier PF≥0.9.

**Runner:** `scripts/edge-atr2-ablation.ts`  
**Artifact:** `/opt/cursor/artifacts/edge-atr2-ablation.json`

## Results

| id | earlier45 (n / net / PF) | oos45 (n / net / PF) | full90 (n / net / PF) | pass |
|---|---|---|---|---|
| baseline ATR≥1.0 | 13 / +$2.82 / 1.139 | 46 / −$45.48 / 0.673 | 69 / −$54.64 / 0.712 | no |
| **ATR≥2.0** | 4 / +$16.58 / ∞ | 30 / −$35.35 / **0.641** | 41 / −$25.14 / 0.794 | **no** |

ATR≥2.0 cut trades (~40%) and improved full90 net vs baseline, but **OOS PF worsened** (0.673 → 0.641) and avgLoss deepened (OOS −$8.71 → −$9.86) — survivors inherit wider ATR stops. Earlier half n=4 is not decision-grade.

**Promotion bar: FAIL.** Do not raise `MIN_ATR_PERCENT` to 2.0.

## Structural read (unchanged)

Fee-aware TREND on CAD10 still shows avgWin ~$3 vs avgLoss ~$7–10. Entry floors that select higher ATR do not fix R:R without a matching stop/size redesign. Exit-parameter mining (trail activate/giveback, SL 1.2) already failed the locked matrix.

## Correctness follow-up (shipped separately)

Paper/live `exitManager` reads `STRATEGY_EXIT_CONFIGS.TREND.trailActivatePercent` (**0.014**). Single-strategy `backtestEngine` reads `V2_CONFIG.TRAILING_ACTIVATE_PERCENT` (**was 0.01**). Ablations that mutate `V2_CONFIG` trail knobs therefore do not match paper exit behavior. Syncing `V2_CONFIG.TRAILING_ACTIVATE_PERCENT → 0.014` aligns research fills with paper without changing live exitManager paths that already use STRATEGY_EXIT.

Residual desync (**fixed 2026-09-28 15:35 UTC**): `backtestEngine` now resolves TREND trail/quick-kill/time-kill from `STRATEGY_EXIT_CONFIGS` (bar×tf), matching paper `exitManager`. See `v2/backtest/backtestEngine.exitParity.test.ts`.

## Recommendation

**no promote** on ATR floor or any TREND exit param from this pass. Keep paper soak; next research should either (a) port STRATEGY_EXIT into backtestEngine then re-ablate exits apples-to-apples, or (b) attack avgLoss via risk-cap / SL redesign under the same fee-aware half-split — not more entry-floor mining.
