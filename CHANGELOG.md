# Changelog

> **⚠️ History rewrite — 2026-07-29.** Git history was rewritten on this date to remove the VPS
> host address from all commits. **Every commit SHA created before 2026-07-29 changed.** SHAs cited
> in entries below no longer resolve against this repository; they are retained as a record of what
> shipped together, not as usable references. A pre-rewrite backup exists as
> `cryptogod-backup-2026-07-29.bundle` (verified complete, kept outside the repo) — clone it with
> `git clone cryptogod-backup-2026-07-29.bundle` if you need to resolve an old SHA.
>
> If you have an existing local clone from before this date, its history has diverged and cannot be
> fast-forwarded. Re-clone rather than attempting to merge.

Bidirectional change log between local Claude (developer machine) and VPS Claude (live trading host). Both agents must add an entry to this file for every material change they ship, and read this file before making changes when accessing the repo on the VPS.

**Why this file exists:** Both agents work on the same code from different machines, with different views of the live trading state. Without a shared change log, drift accumulates: code changes happen in one place that the other doesn't see, monitoring criteria get out of sync, and miscommunications cause regressions (e.g., the 3-day V2 engine crash from commit `2a96f56` that local Claude initially flagged as "non-blocking").

**Format:** Newest entries at top. Group changes shipped together as one entry. Each entry includes everything the *other* agent needs to act on the change correctly.

## How to use this file

**When you ship a change:** add an entry at the top with the template below. Push with the commit. The other agent's session will see the update on its next git pull / fetch.

**When you access the VPS for any reason:** read the latest entries (at minimum entries since your previous interaction) so you're current on what changed, why, and what's being monitored. Don't assume your local view of the code matches what's running.

**When you make a material trading-config change:** also follow the standing rule in CLAUDE.md ("Stats Baseline Resets") — note the new baseline timestamp in your changelog entry.

## Entry template

```
## YYYY-MM-DD HH:MM UTC — <short title> — <agent: local-claude | vps-claude | user>

**Commits:** <SHA short-list>
**Files changed:** <brief list>
**Stats baseline reset:** yes / no — if yes, new baseline = <epoch ms>

**What changed:**
<one or two short paragraphs>

**Why:**
<motivation, data references, hypothesis being tested>

**What to monitor / watch for:**
- <specific metric, query, or behavior>
- <expected outcome and threshold for "this isn't working">
- <how to roll back if needed>
```

---

## 2026-10-06 12:40 UTC — MOMENTUM pending-confirm parity (paper) — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/tradeEngine.ts`, `v2/backtest/backtestEngine.ts`, `v2/backtest/types.ts`, `scripts/edge-mom-confirm-parity-9045.ts`, reviews, CHANGELOG/README
**Stats baseline reset:** **no**

**What changed:**
- Research: under ADX20 stack, MOMENTUM+confirm T+2 matches earlier (n=5 PF0.86) and **improves OOS** (PF 4.19→4.85, net +$15.63→+$18.87) vs next-bar MOMENTUM.
- Paper `tradeEngine` now pending-confirms **MOMENTUM** as well as TREND.
- Backtest opt-in `entryFilters.confirmMomentum` (default off = legacy next-bar).

**Why:**
Hardens the AVAX-style same-loop MOMENTUM fill; fee-aware evidence shows no earlier damage and better OOS. Not a promote (still n-starved).

**What to monitor / watch for:**
- New MOMENTUM signals log `CONFIRM pending` then arm/enter or reject — never same-loop execute.
- Contaminated open AVAX (pre-fix) still excluded from cohort.
- Rollback: `useConfirm && strategy === 'TREND'` only.

---

## 2026-10-06 12:30 UTC — MOMENTUM ADX parity + health open count + re-baseline — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/strategyRunner.ts`, `v2/backtest/backtestEngine.ts`, `v2/engine/tradeEngine.ts`, `v2/engine/strategyRunner.adxParity.test.ts`, `scripts/edge-strong-adx20-mom-parity-9045.ts`, reviews, CHANGELOG/README
**Stats baseline reset:** **no** — bugfix; contaminated AVAXUSD MOMENTUM fill excluded from cohort.

**What changed:**
- Paper soak: AVAXUSD scan-PASS STRONG_UP, TREND ADX-blocked at 15.2, then **MOMENTUM filled** same loop @ $11.67 (~$212) — ADX desync.
- `strategyRunner` applies `ADX_THRESHOLDS.TREND_MIN` to MOMENTUM as well as TREND; backtest MOMENTUM honors `minAdx`.
- `getV2Status` counts **all** main-pipeline opens/closes (was TREND-only — hid MOMENTUM AVAX).
- Re-baseline 90/45 under parity: **anyPromote=false**; MOMENTUM on helps OOS (+3 trades) not earlier; exit/chase knobs still fail n/PF.

**Why:**
Directional entries must not bypass the ADX ranging gate. Soak health must show MOMENTUM positions managed by tradeEngine.

**What to monitor / watch for:**
- No new MOMENTUM fills when soak logs `ADX block` for that ticker.
- Health `openPositions` ≥1 while contaminated AVAX is open.
- Contaminated AVAX exit PnL — exclude from cohort.
- Rollback ADX: restore MOMENTUM over `passedScan` — not recommended.

---

## 2026-10-06 00:40 UTC — STRONG_UP+confirm+ADX20 n-starve probes (no promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-strong-maxatr-adx20-9045.ts`, `scripts/edge-strong-confirm-adx20-longwindow.ts`, `docs/reviews/2026-10-06-strong-confirm-adx20-nstarve.md`, CHANGELOG/README
**Stats baseline reset:** **no** — research only; paper config unchanged.

**What changed:**
- Soak: ADAUSD STRONG_UP but ATR%~2.7 &gt; max 2.5 (blocked); cohort still 0 post UP-rollback baseline; watchdog kicked (incl. 224s stall).
- MAX_ATR grid 2.5–2.8 under STRONG_UP+confirm+ADX20: 2.6–2.7 identical to 2.5; 2.75+ hurts OOS PF — **keep MAX 2.5**.
- Longer windows / scanner minATR=1.0: OOS strong, earlier still fails n or PF — **no promote**.

**Why:**
Seek n≥10 under paper ADX parity without re-adding UP. Not found this cycle.

**What to monitor / watch for:**
- Do not raise MAX_ATR for ADA near-misses; do not lower minATR without earlier-PF clear.
- Next: exit/signal features under STRONG_UP+confirm+ADX20, or wait for natural STRONG_UP+ADX fills.

---

## 2026-10-05 12:30 UTC — rollback UP (ADX≥20 evidence); ADX block soak log — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/config.ts`, `v2/engine/strategyRunner.ts`, `v2/engine/promotePackage.test.ts`, `v2/engine/cadUniverse.test.ts`, research scripts, docs/CHANGELOG/README
**Stats baseline reset:** **yes** on `:3137` after restart — material regime tighten (UP removed).

**What changed:**
- Fee-aware search under `minAdx=20`: every UP-inclusive stack fails robust 90/45; STRONG_UP+confirm is PF-positive but n-starved (n≈6–7).
- Paper: `ALLOWED_REGIMES` → `['STRONG_UP']` only; keep confirm+chase+ATR band+ADX.
- Soak log: rate-limited `[V2] ADX block …` when scan-PASS tickers fail ADX.

**Why:**
Prior UP promote omitted paper ADX. With ADX parity, UP trades destroy earlier/OOS PF; rolling back UP is an evidence-backed tighten.

**What to monitor / watch for:**
- Scanner rejects UP with “not in allowed: [STRONG_UP]”.
- `ADX block` lines when DOGE/LINK/etc PASS ATR/regime but ADX&lt;20.
- Do not re-enable UP without a fee-aware clear that includes `minAdx=20`.
- Rollback: restore `ALLOWED_REGIMES: ['STRONG_UP','UP']` (not recommended).

---

## 2026-10-05 00:30 UTC — ADX backtest parity; promote package optimistic vs paper — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/backtest/types.ts`, `v2/backtest/backtestEngine.ts`, `scripts/edge-adx-parity-9045.ts`, `scripts/diag-pass-no-signal.ts`, docs/CHANGELOG/README
**Stats baseline reset:** **no** — research/diagnostics; no runtime trading-parameter change.

**What changed:**
- Soak: SOLUSD artifact closed trailing **+$0.86**; watchdog kicked after 42220s stale (proven).
- ADA/LINK/AVAX scan-PASS but ADX 12–17 &lt; 20 → no TREND signals (`diag-pass-no-signal`).
- Backtest: optional `entryFilters.minAdx`. With promote package + **ADX≥20**, robust 90/45 **fails** (OOS PF 0.87 / −$3.70). No-ADX control still passes.
- **Keep paper ADX≥20.** Prior promote clear was optimistic vs paper.

**Why:**
Paper darkness with PASS tickers was ADX, not confirm/chase. Research that omits ADX overstates fill rate and expectancy vs `:3137`.

**What to monitor / watch for:**
- Future promote claims must include `minAdx: 20` (or document explicit no-ADX).
- Do not lower `ADX_THRESHOLDS.TREND_MIN` without a fee-aware clear under ADX.
- Next research: find a stack that clears 90/45 *with* paper ADX parity.

---

## 2026-10-04 12:15 UTC — loop watchdog + minATR ablation (keep 1.5) — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/loopWatchdog.ts`, `v2/engine/loopWatchdog.test.ts`, `v2/engine/tradeEngine.ts`, `scripts/edge-minatr-9045.ts`, docs/CHANGELOG/README
**Stats baseline reset:** **no** — ops watchdog + research only; MIN_ATR stays 1.5.

**What changed:**
- Wall-clock loop watchdog: kick stale loops after VM suspend; force-unlock hung `loopInProgress` after 5 min.
- Ablated minATR 1.0/1.25/1.5/1.75/off under promote package — **keep 1.5** (1.0–1.5 identical on 90/45).
- Soak: SOLUSD artifact long trailing ~+$1.9% (stop above entry); ATR-starved scanner; no new clean fills.

**Why:**
Suspend repeatedly stalls exits/entries; watchdog restores wall-clock progress. ATR floor loosen was hypothesized for soak starvation but has no fee-aware trade-count gain.

**What to monitor / watch for:**
- Logs: `Watchdog kick` / `Watchdog force-unlock` after host resume.
- Do not lower MIN_ATR without a new window where lower floors add trades *and* clear the bar with better OOS.
- SOL artifact exit: tag P&L as contaminated.

---

## 2026-10-04 00:30 UTC — fix confirm skip-bar after VM suspend — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/pipeline/pendingConfirmEntry.ts`, `v2/pipeline/pendingConfirmEntry.test.ts`, `v2/engine/tradeEngine.ts`, `v2/engine/promotePackage.test.ts`, docs/CHANGELOG
**Stats baseline reset:** **no** — correctness fix; no trading-parameter change.

**What changed:**
- Paper soak: after ~11.5h VM suspend, pending SOLUSD confirm skipped T+1/T+2 and armed on `2026-10-04T00:00Z`, then entered (first post-baseline fill @ $119.30 — suspend artifact).
- Pending confirm now requires the **exact next bar** (`signalBarTime + barIntervalMs`); skipped bars drop with `missed confirm bar`.

**Why:**
Backtest confirmMode uses candles[bar+1] only. Accepting any later closed bar after suspend breaks T+2 parity and can fill at the wrong price.

**What to monitor / watch for:**
- After suspend/resume with a stale pending: expect `CONFIRM drop … missed confirm bar`, never arm/enter on a skipped window.
- Existing anomalous SOLUSD open may exit via normal stops/trail; do not treat its P&L as clean promote-package evidence.
- Rollback: revert pendingConfirmEntry interval check (not recommended).

---

## 2026-10-03 12:30 UTC — chase-threshold ablation + CONFIRM reject always-log — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/tradeEngine.ts`, `scripts/edge-chase-threshold-9045.ts`, `docs/reviews/2026-10-03-chase-threshold-soak.md`, `CHANGELOG.md`, `README.md`
**Stats baseline reset:** **no** — no trading-config change; observability + research only.

**What changed:**
- Paper soak: first promote-package TREND signal (SOLUSD) chase-rejected at closeLoc 0.89.
- Ablated chase 0.75/0.80/0.85/0.90/off under fixed promote package. All clear robust 90/45; OOS identical for 0.75–0.90 → **keep chase≤0.80**.
- `CONFIRM reject` now always logs (was rate-limited to every 5th loop).

**Why:**
Live reject looked like a fill-starvation bug; evidence says the gate is binding as designed and loosening does not improve OOS.

**What to monitor / watch for:**
- Continuous `CONFIRM reject … chase` on the same 4h bar is expected until the bar rolls.
- Next non-chase signal should log `CONFIRM pending` → `armed` → `entering`.
- Do not loosen chase or disable ENTRY_CONFIRM without a new fee-aware promote.

---

## 2026-10-03 00:20 UTC — wire UP+confirm promote package into paper runtime — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/engine/config.ts`, `v2/engine/tradeEngine.ts`, `v2/engine/cadUniverse.test.ts`, `v2/engine/promotePackage.test.ts`, `v2/pipeline/pendingConfirmEntry.ts`, docs/CHANGELOG/README
**Stats baseline reset:** **yes** on `:3137` paper DB after restart — material entry/regime change.

**What changed:**
- Runtime: `ALLOWED_REGIMES=['STRONG_UP','UP']`, `MAX_ATR_PERCENT=2.5`, `MIN_ATR_PERCENT=1.5`, `ENTRY_CONFIRM_ENABLED` with bullish_close + chase≤0.80.
- `tradeEngine` stashes TREND signals through pending confirm (T→confirm→enter); advances/fills even when no new signals that loop.
- Do not disable `ENTRY_CONFIRM_ENABLED` while UP remains allowed.

**Why:**
Fee-aware robust 90/45 + 60/60 clear for this package (2026-10-02). Paper was dark under STRONG_UP-only while HTF sat in UP.

**What to monitor / watch for:**
- Logs: `CONFIRM pending`, `CONFIRM armed`, `CONFIRM entering`, `CONFIRM drop`, `CONFIRM reject`.
- New paper fills should show TREND entries after a bullish confirm bar; zeroHoldSL should stay rare.
- Rollback: revert config to STRONG_UP-only / MAX_ATR=8 / MIN_ATR=1.0 / ENTRY_CONFIRM_ENABLED=false and restart.

---

## 2026-10-02 12:30 UTC — UP+confirm+minATR clears robust 90/45 (wire pending) — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-up-confirm-9045.ts`, `scripts/edge-up-confirm-promote-stress.ts`, `docs/reviews/2026-10-02-up-confirm-promote-candidate.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research only; paper still STRONG_UP-only / MAX_ATR=8 / no confirmMode.

**What changed:**
- Paper soak dark: all HTF=UP, none STRONG_UP.
- Ablated UP under confirm stack. **UP+STRONG_UP + MAX_ATR=2.5 + bullish_close + chase + minATR≥1.5** clears robust 90/45 (earlier n=20 PF1.20 / OOS PF1.95) and 60/60. Bare allow_UP still fails.
- Stress: 45/45 earlier n=4 (all wins) fails n≥10 only; full90 PF1.62 / +$33.

**Why:**
Seek a path that can trade in the current all-UP regime without repeating bare allow_UP failure.

**What to monitor / watch for:**
- Do **not** enable UP alone. Promote only as the full package including pending-confirm in the paper engine.
- Shipped `v2/pipeline/pendingConfirmEntry.ts` state machine (+tests); tradeEngine/config wire is next cycle.
- Rollback: N/A (no runtime change).

---

## 2026-10-02 00:20 UTC — confirm-stack exit ablations + 1h probe blocked (no promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-confirm-exit-9045.ts`, `scripts/edge-confirm-1h-9045.ts`, `docs/reviews/2026-10-02-confirm-exit-9045.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research only; paper exits unchanged.

**What changed:**
- Ablated time-kill / quick-kill / wider-SL under corrected confirm+MAX_ATR+chase on robust 90/45 — **all fail**. Longer time-kill hurt earlier; OOS stays trailing-dominated.
- 1h alternate-TF probe **blocked** (CryptoCompare 401; Kraken ~30d 1h cap → earlier90 empty).

**Why:**
Prior autopsy pointed at time_kill fee-bleed on earlier90; exit knobs were the pre-registered response.

**What to monitor / watch for:**
- Do not lengthen paper time-kill or widen SL from this cycle.
- 1h research needs a longer candle source before re-attempt.
- Rollback: revert this commit.

---

## 2026-10-01 12:30 UTC — confirm pre-entry exit fix + robust 90/45 (no promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/backtest/backtestEngine.ts`, `v2/backtest/types.ts`, `v2/backtest/confirmBar.test.ts`, `v2/backtest/entryBarQuality.test.ts`, `scripts/edge-confirm-robust-9045.ts`, `docs/reviews/2026-10-01-confirm-robust-9045.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research/correctness only; paper runtime unchanged.

**What changed:**
- Fixed confirmMode/next-bar pre-entry exit marks (`holdBars=-1`).
- Added `bullish_and_above`, `min/maxSignalAtrPercent`, `isPositionLiveOnBar`.
- Robust 90/45 ablations (earlier n≥10 required): **all fail**. Best directional: minATR≥1.5 lifts earlier PF to 1.247 but n=6 only.

**Why:**
Autopsy of fragile confirm stack showed invalid pre-entry stops; after fix, still no robust earlier window.

**What to monitor / watch for:**
- Do not wire confirm/MAX_ATR/minATR into paper.
- Re-runs supersede earlier confirm-bar numeric tables where holdBars&lt;0 appeared.
- Rollback: revert this commit.

---

## 2026-10-01 00:25 UTC — confirmation-bar entry (fragile bar pass; no paper promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/backtest/types.ts`, `v2/backtest/backtestEngine.ts`, `v2/backtest/confirmBar.test.ts`, `scripts/edge-confirm-bar.ts`, `docs/reviews/2026-10-01-confirm-bar.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research-only `entryFilters.confirmMode`; paper scanner/executor unchanged.

**What changed:**
- Added optional `confirmMode` (`bullish_close` | `close_above_signal`): signal → confirm → enter T+2 open.
- Ablated confirm ± MAX_ATR=2.5 ± chase. Stack **MAX_ATR=2.5 + bullish_close + closeLoc≤0.80** meets the numeric bar (OOS PF 3.783 / +$30.35, earlier PF 1.428) but earlier n=4 only — **not promoted**.

**Why:**
Pre-registered follow-up to holdBars=0 stop autopsy / entry-bar quality miss.

**What to monitor / watch for:**
- Longer-window stress (`edge-confirm-bar-longwindow.ts`): 90/45 **fails** earlier PF=0.456; 60/60 barely passes (earlier PF=0.918, n=7). Still **do not** wire into paper.
- Confirm alone zeros zeroHoldSL and helps OOS but fails earlier / full90.
- Rollback: revert this commit.

---

## 2026-09-30 12:10 UTC — entry-bar quality filters (no promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/backtest/types.ts`, `v2/backtest/backtestEngine.ts`, `v2/backtest/entryBarQuality.test.ts`, `scripts/edge-entry-bar-quality.ts`, `docs/reviews/2026-09-30-entry-bar-quality.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research-only `entryFilters` on backtest config; paper scanner/executor unchanged.

**What changed:**
- Added optional `BacktestConfig.entryFilters` + `passesEntryBarQuality` (chase closeLoc / wide range÷ATR).
- Ablated chase, wide-bar, and MAX_ATR=2.5 combinations. Best: MAX_ATR=2.5+chase → OOS PF 0.971 / −$1.61, earlier PF 0.393 — **fails** promotion bar.

**Why:**
Loss autopsy showed holdBars=0 stop-outs; chase/chaos filters were the pre-registered structural response.

**What to monitor / watch for:**
- Do not wire entryFilters into paper without a full bar pass.
- Wide-bar filter non-binding here; chase helps earlier half only.
- Rollback: revert this commit.

---

## 2026-09-30 00:10 UTC — loss-structure autopsy + MAX_ATR ceiling (no promote) — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-loss-structure.ts`, `scripts/edge-max-atr-ceiling.ts`, `docs/reviews/2026-09-30-loss-structure-and-atr-ceiling.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research/docs only; paper `MAX_ATR_PERCENT` remains 8.

**What changed:**
- Autopsied fee-aware OOS trades: stop_loss dominates (−$112, R≈−1, often same-bar); trailing net positive; ATR 2.5–4% worst band.
- Ablated `MAX_ATR_PERCENT` 8→2.5 / 3.0. max=2.5 is best OOS (PF 0.945 / −$3.59) but **fails** promotion (earlier PF 0.256, OOS net≤0).

**Why:**
Exit/entry threshold mining failed; need a structural diagnosis of the win/loss asymmetry before changing paper gates.

**What to monitor / watch for:**
- Do **not** promote MAX_ATR 2.5 from OOS alone.
- Paper soak unchanged. Next: combine ceiling with a second pre-registered lever only if earlier half can be validated.
- Rollback: revert this research/docs commit.

---

## 2026-09-29 12:05 UTC — entry/regime ablations (no promote); refresh Evidence under parity — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-entry-regime-ablation.ts`, `docs/reviews/2026-09-29-entry-regime-ablation.md`, `README.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — docs/research only; paper gates unchanged.

**What changed:**
- Fee-aware CAD10 entry/regime matrix (score, confidence, expected-return, volume, momentum-off, allow_UP). **anyPromote=false.** Adding `UP` crushed earlier-half PF to 0.23.
- README Evidence + risk notice updated to the parity-protocol OOS (PF≈0.50 / −$74) — older PF≈1.02 windows are superseded for promotion decisions. Documented trail fee floor ≈1.56%.

**Why:**
Exit mining failed last cycle; entry threshold sweeps and regime loosening also fail. Public docs must not advertise near-breakeven under a protocol we no longer trust for promotion.

**What to monitor / watch for:**
- Stay paper. Do not add `UP`. Do not promote threshold tweaks that are non-binding on this sample.
- Next research: avgLoss/signal quality, not more gate knobs.
- Rollback: revert this docs/research commit.

---

## 2026-09-29 00:05 UTC — TREND exit-parity ablations (no promote) + entry SL/TP parity — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-exit-parity-ablation.ts`, `docs/reviews/2026-09-29-exit-parity-ablation.md`, `v2/backtest/backtestEngine.ts`, `v2/backtest/backtestEngine.exitParity.test.ts`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research only; paper TREND exits unchanged.

**What changed:**
- Ran fee-aware CAD10 TREND exit matrix under STRATEGY_EXIT parity (timeKill bars, trail, SL, QK). **anyPromote=false** (best OOS PF 0.565 / −$56.73 for SL 1.2 — still fails bar).
- Backtest TREND entry SL/TP now uses `STRATEGY_EXIT_CONFIGS.TREND.slAtrMult/tpAtrMult` (matches paper riskGate/executor) instead of parallel `V2_CONFIG` multipliers.

**Why:**
Need honest OOS under the same exit knobs paper runs. Exit mining on a PF≈0.5 OOS baseline does not justify promoting.

**What to monitor / watch for:**
- Stay paper. Do not tighten SL or lengthen time-kill without a passing bar.
- Note: trail activate is fee-floored ≈1.56% in both paper and backtest.
- Next research: entry/regime path, not more single-knob exit sweeps.
- Rollback: revert this commit (runtime paper unchanged either way).

---

## 2026-09-28 15:35 UTC — backtestEngine exit parity with paper STRATEGY_EXIT_CONFIGS — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/backtest/backtestEngine.ts`, `v2/backtest/backtestEngine.exitParity.test.ts`, `CHANGELOG.md`
**Stats baseline reset:** **no** — research/backtest fidelity only; paper runtime unchanged.

**What changed:**
`checkExitOnBar` now resolves TREND trail activate (fee-floored), trail giveback, quick-kill bars/minGain/slMult, and **time-kill as bar×tf** from `STRATEGY_EXIT_CONFIGS.TREND` (same source as paper `exitManager`). Quick-kill also clamps stops to the valid side of bar close. Unit tests lock 4h/1h bar resolution and 2-bar time-kill semantics.

**Why:**
Exit ablations were still using `V2_CONFIG.TIME_KILL_MS` (6h wall) while paper kills after `timeKillBars × tf` (2×4h). Without parity, research cannot steer paper profitability.

**What to monitor / watch for:**
- Re-run fee-aware TREND exit ablations before promoting any paper exit knob.
- Paper :3137 behavior unchanged by this commit.
- Rollback: revert this commit.

---

## 2026-09-28 15:25 UTC — ATR≥2.0 ablation (no promote) + trail-activate research sync — cursor-cloud

**Commits:** this branch
**Files changed:** `scripts/edge-atr2-ablation.ts`, `docs/reviews/2026-09-28-atr2-ablation-and-exit-desync.md`, `v2/engine/config.ts` (`TRAILING_ACTIVATE_PERCENT` 0.01→0.014), `CHANGELOG.md`
**Stats baseline reset:** **no** — paper exitManager already used STRATEGY_EXIT 0.014; this only aligns backtest/research with paper. No ATR floor / regime / ML / live change.

**What changed:**
- Ran fee-aware CAD10 TREND ablation of `MIN_ATR_PERCENT` 1.0→2.0 (highest-leverage untested entry filter after the locked Sep-22 matrix). **Failed promotion bar** (OOS PF 0.641, net −$35.35). Research note recorded; **no ATR promote**.
- Synced `V2_CONFIG.TRAILING_ACTIVATE_PERCENT` to **0.014** so `backtestEngine` matches `STRATEGY_EXIT_CONFIGS.TREND` / paper `exitManager`.

**Why:**
Jul-23 live bands suggested edge in ATR 2–3%; needed a fee-aware half-split before any floor raise. Separately, trail ablations were mutating a 1% V2_CONFIG knob while paper trailed at 1.4%.

**What to monitor / watch for:**
- Stay paper. Do not raise ATR floor. Do not enable ML/live.
- Residual addressed in the 15:35 UTC entry (`STRATEGY_EXIT_CONFIGS` ported into `backtestEngine`).
- Rollback: revert the config one-liner only (`TRAILING_ACTIVATE_PERCENT` → 0.01); does not change live exitManager.

---

## 2026-09-28 15:09 UTC — Announce CryptoTitan as CryptoGod v2.0 continuation — local-claude

**Commits:** merged from main
**Files changed:** `README.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`
**Stats baseline reset:** **no** — documentation only; no trading config change.

**What changed:**
Documented CryptoTitan as the **official v2.0 continuation** of CryptoGod. README lineage, clone URL, CI badge, docs index, and architecture now point at this repo as active and at CryptoGod as the discontinued historical lineage (with cross-links both ways).

**Why:**
Readers following CryptoGod need a clear successor path; this repo is where paper hardening and Canadian-universe work continues.

**What to monitor / watch for:**
- Docs only — no engine or deploy change.
- Rollback: revert the announce docs commit on main if needed.

---

## 2026-09-22 12:15 UTC — Reject stale WS quotes in getLatestPrice — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/exchange/wsPriceFreshness.ts`, `v2/exchange/wsPriceFreshness.test.ts`, `v2/exchange/krakenAdapter.ts`, `v2/exchange/cryptoComV2Adapter.ts`, `services/krakenWebsocketService.js`, `services/websocketService.js`, `CHANGELOG.md`
**Stats baseline reset:** no — quote freshness only; no risk-gate / ticker / ML / live enablement

**What changed:**
WebSocket `latestPrices` now record per-ticker update timestamps. V2 Kraken/Crypto.com `getLatestPrice` only trusts a WS quote when it is ≤60s old; otherwise falls back to REST 1m close.

**Why:**
Paper soak SOLUSD (`2784ca72`, :3137) opened at 4h `close_price` ~117.32 and, in the same loop (`holdMs=1`), stop-loss'd on a WS quote of ~99.04 for −$35.52 — not a real 1ms market gap. Host suspend leaves stale WS prints while signal candles refresh via REST.

**What to monitor / watch for:**
- No same-loop entry→exit with |Δprice| ≫ ATR while spot (REST/Kraken ticker) agrees with entry.
- After VM resume, first exits should REST-fallback until WS ticks arrive.
- Stay paper; timer remains 12h.

---

## 2026-09-20 00:10 UTC — Clamp quick-kill stop to valid side of price — cursor-cloud

**Commits:** this branch
**Files changed:** `v2/pipeline/exitManager.ts`, `v2/pipeline/exitManager.quickKillClamp.test.ts`, `CHANGELOG.md`
**Stats baseline reset:** no — exit correctness only; no risk-gate / ticker / ML / live changes

**What changed:**
Quick-kill stop tightening now requires the candidate stop to stay on the valid side of `currentPrice` (same clamp BE already had). Underwater longs can no longer raise `currentStop` above spot; underwater shorts can no longer lower it below spot.

**Why:**
Paper soak DOTUSD (`3bc03cfb`, :3137 / `data/paper-3137`) held ~12h then logged `Holding: PnL -2.77%, stop 1.12` at price `1.1055` with stop `1.11795` (quick-kill `entry - 0.6×ATR`), and exited next loop as `Trailing/BE`. Peak never left entry; trail never armed — stop was raised through the market.

**What to monitor / watch for:**
- Holding decisions must never show long `currentStop > currentPrice` (or short stop below price) after a non-exit loop.
- Quick-kill may leave the initial stop untouched when price is already through the would-be tighter level; time-kill / initial SL still apply.
- Stay paper; do not loosen gates or enable live/ML.

---

## 2026-09-09 19:05 UTC — Paper safety: proxy auth, live order assert, CAD sniper filter — cursor-cloud

**Commits:** this branch
**Files changed:** `middleware/adminAuth.js`, `v2/engine/tradeMode.ts`, `v2/engine/cadUniverse.ts`, `v2/engine/bearishBootSummary.ts`, `v2/engine/bearishServices.ts`, `v2/engine/sniperEngine.ts`, `v2/exchange/krakenAdapter.ts`, `v2/exchange/cryptoComV2Adapter.ts`, `v2/index.ts`, `.gitignore`, tests
**Stats baseline reset:** no — safety/honesty only; no trading-parameter change; not VPS-deployed

**What changed:**
- Admin auth no longer treats nginx→node (`X-Real-IP` / `X-Forwarded-For`) as localhost-exempt.
- `assertLiveOrdersAllowed()` dual-interlock at every V2 Kraken/Crypto.com place/cancel path.
- DCA real buys require `DCA_SIM_ONLY=false` **and** `V2_MODE=live` + `V2_LIVE_CONFIRMED=yes`; otherwise forced sim.
- Sniper pair refresh filters to CAD USD allowlist (sniper remains `ENABLED=false`).
- Bearish boot logs report `shorts=off staking=off arb=off dca=sim` instead of claiming all services running.
- Ignore `data/*.json` backtest exports.

**Why:**
Close remaining paper-soak holes (proxied flag mutation, DCA/adapter live paths without dual interlock, latent non-CAD sniper listings, dishonest logs) without enabling live/ML/extra engines.

**What to monitor / watch for:**
- Behind nginx, `POST /api/config/flag` and other admin routes require `ADMIN_API_KEY` even when Node sees `req.ip=127.0.0.1`.
- Paper soak must never call exchange place methods; if a caller tries, adapters throw.
- Sniper still off; CAD filter is defense-in-depth only.
- Stay paper; promotion bar still not met (see prior replay entry).

---

## 2026-09-09 18:15 UTC — Paper soak hardening + fee-aware replay refresh — cursor-cloud

**Commits:** this branch
**Files changed:** `services/database.js`, `services/systemConfig.js`, `ecosystem.config.cjs`, `.env.example`, `v2/engine/tradeEngine.ts`, `v2/engine/rejectionTally.ts`, tests (`cadUniverse`, `adminAuth`, `systemConfigDefaults`, `databasePath`, `rejectionTally`), `CHANGELOG.md`, `README.md`
**Stats baseline reset:** no — not deployed to a VPS; paper-only soak on isolated SQLite

**What changed:**
- `DATA_DIR` / `SQLITE_PATH` isolate paper SQLite from a stale `data/trading.db`.
- `systemConfig` defaults now match paper posture: `ML_GATEKEEPER_ENABLED=false`, `SNIPER_MODE_ENABLED=false` (V2 entry gating still uses `V2_CONFIG`, also false).
- `ecosystem.config.cjs` sets `V2_LIVE_CONFIRMED=no` explicitly.
- Health counters `rejectedByScan` / `rejectedBySignal` now increment (were stuck at 0).
- Tests lock CAD USD universe, admin flag auth for non-localhost, DB path isolation, and rejection tally.

**Fee-aware next-bar-open replay (5 bps/side, STRONG_UP, 4h, 10 CAD tickers, 0.52% RT taker), re-run 2026-09-09:**

| Window | Trades | Net | PF |
|---|---|---|---|
| 90d (2026-06-11 → 2026-09-09) | 54 | +$2.01 | 1.02 |
| First 45d | 13 | -$4.20 | 0.80 |
| Second 45d | 31 | +$9.72 | 1.17 |

**Decision:** stay paper-only. First half is negative; full-window PF ≈ 1 is not a promotion bar. Do not cherry-pick tickers. Do not enable live / ML / extra engines.

**Why:**
Confirm CryptoTitan paper boot, close live-interlock / CAD / auth / config-default holes, and refresh the honest replay before any strategy change.

**What to monitor / watch for:**
- Paper soak: `V2_MODE=paper`, `mode=paper` on `/api/health`, 0 open positions when no `STRONG_UP` — expected.
- `/api/v2/bearish/status`: shorts/staking/arb `enabled=false`; DCA sim-only.
- Sniper/pairs off. Non-localhost `POST /api/config/flag` without `ADMIN_API_KEY` → 401/503.
- Do not reset `stats_baseline_time` until this config is actually deployed.

---

## 2026-09-09 17:30 UTC — CryptoTitan documentation and identity alignment — local-claude

**Commits:** this branch
**Files changed:** `README.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `package.json`, `CHANGELOG.md`
**Stats baseline reset:** no — documentation only; no trading-parameter change

**What changed:**
Root README now describes CryptoTitan: paper-only default, dual live interlock, ten CAD Kraken USD pairs, `STRONG_UP` only, disabled ML/pairs/sniper/MR/shorts, and the corrected next-bar-open 90d replay (47 trades, -$3.63, PF 0.96). Architecture PM2 table now matches `PAIRS_MODE=off`. Package name/description updated. Docs index warns that older specs are historical.

**Why:**
The previous README still advertised CryptoGod with `UP`+`STRONG_UP`, enabled MR/sniper, pairs paper, and an ML gate in the loop — none of which match the running config. The private CryptoTitan remote is the intended home; until GitHub grants this agent access, the branch remains on the cryptoGod lineage.

**What to monitor / watch for:**
- Do not treat README clone URLs as proof the private repo is seeded.
- Trading behavior is unchanged by this entry.

---

## 2026-09-04 15:15 UTC — Canadian paper-trading hardening and evidence-based regime gate — local-claude

**Commits:** this branch
**Files changed:** `serverV2.ts`, `v2/engine/config.ts`, `v2/engine/bearishServices.ts`, `v2/engine/tradeAccounting.ts`, `v2/engine/tradeMode.ts`, `v2/engine/tradeEngine.ts`, `v2/pipeline/executor.ts`, `v2/pipeline/exitManager.ts`, `v2/attribution/attributionStore.ts`, `v2/backtest/backtestEngine.ts`, `v2/backtest/backtestExecution.ts`, `v2/backtest/types.ts`, `scripts/backtest-v2.ts`, `ecosystem.config.cjs`, `.env.example`, `docs/ARCHITECTURE.md`, `package.json`, `package-lock.json`, tests
**Stats baseline reset:** no deployment in this change — reset is required if/when this trading configuration is deployed

**What changed:**
The executable universe now uses the ten approved Canadian Kraken USD bases. The main entry gate is restricted to `STRONG_UP`; unsupported FIL/ICP pairs trading, the unvalidated dynamic-listing sniper, mean reversion, legacy shorts, staking, and arbitrage remain off. Staking previously started in paper mode and could call a real exchange API when credentials were present; it now requires a future explicit enablement/interlock. DCA remains simulation-only. Paper entries and exits now include 5 bps adverse slippage per side, stop gaps fill at the worse observed price, live exits use the exchange-reported fill/fee, and all downstream PnL is sign-correct for shorts.

Main-engine live mode now requires both `V2_MODE=live` and `V2_LIVE_CONFIRMED=yes`; an unconfirmed live request downgrades to paper. The V2 replay now fills signals at the next candle's open and applies adverse slippage on both sides instead of buying at the signal candle's already-known close. The ML gatekeeper and its random A/B bypass are disabled because the training path stores exit-time features and does not provide valid temporal OOS evidence.

The runtime flag mutation endpoint now uses the existing admin-auth middleware; remote callers cannot change persisted feature flags without `ADMIN_API_KEY`. Missing lint dependencies were restored, and patched direct/transitive dependency releases reduce the production audit from eight high-severity advisories to three moderate Express 4 advisories; clearing those remaining advisories requires a separately tested Express 5 migration.

**Why:**
The initial same-bar replay showed `UP` as the dominant losing regime, motivating its removal, but its dollar figures were not causal. The corrected next-bar-open replay of `STRONG_UP` only is approximately break-even over 90 days: **47 trades, -$3.63, PF 0.96**. Non-overlapping halves are **-$22.47 / PF 0.46** (17 trades) and **+$7.47 / PF 1.23** (19 trades). This does not establish a durable profitable edge; the engine remains paper-only to gather a forward sample.

**What to monitor / watch for:**
- Paper trades must be limited to the approved USD universe and `STRONG_UP` entries.
- Re-run fee-aware, pessimistic validation before any live-mode discussion; require positive OOS expectancy and PF > 1 after slippage.
- Do not set `V2_LIVE_CONFIRMED=yes` until forward paper results meet a pre-registered promotion rule.
- Compare paper fills to contemporaneous Kraken quotes; sustained realized slippage above 5 bps invalidates the current assumption.
- If deployed, set a new `stats_baseline_time`; rollback by reverting this branch commit.

---

## 2026-07-29 — Cleanup follow-ups: stale comments, dead deploy paths, /api 404 masking (NO trading change) — local-claude

**Commits:** squash `c1241b5` (PR #2)
**Files changed:** `serverV2.ts`, `v2/index.ts`, `core/arbitrageEngine.ts`, `types/services.d.ts`, `deploy/deploy.ps1`, `deploy/setup-vps.sh`
**Stats baseline reset:** **no** — no strategy, threshold, gate, sizing rule, or config value altered.

**What changed:**

*`/api/*` no longer masks missing routes.* The SPA catch-all `app.get('*')` in `serverV2.ts` answered every unmatched path with `200` + `dist/index.html`, including `/api/*`. Callers expecting JSON got HTML, `res.json()` threw, and component `catch` blocks swallowed it — a missing API route was indistinguishable from a working one. An `app.use('/api', ...)` guard now returns `404 {error, path}`, registered after every real API route and before the catch-all.

*Momentum comment corrected.* `v2/index.ts` said "Default disabled (MOMENTUM_CONFIG.ENABLED=false) — flip to true when ready to ship live". `engine/config.ts:257` has had `ENABLED: true` since 2026-05-18. **Momentum has been trading while the code comment said it was off.** Backtest figures preserved.

*`core/arbitrageEngine.ts`.* `scan()` is retained as the reference implementation for the eventual rewrite, but `private` made tsc flag it unused, previously silenced with `void this.scan;`. Now `protected` — the error goes away honestly and the method is no longer bait for deletion. Engine remains a no-op.

*Deploy scripts.* `deploy.ps1` lost its `docker` mode (it built the deleted `canuck-trader-pro/backend/Dockerfile`); `archive` and `git` modes untouched. `setup-vps.sh` lost an unreachable `systemctl is-active trading-bot` branch, stale docker help text, and a Python 3.12 install step; provisioning steps renumbered to a contiguous 1-10 (previously mislabelled, skipping 9). **`pm2 start server.js` → `pm2 start ecosystem.config.cjs`** — `server.js` was deleted, and the ecosystem file carries the `--experimental-strip-types` flag the TypeScript entrypoint requires. The old line would have failed on a fresh VPS provision.

**Why:**
These were logged as follow-ups during the 2026-07-29 cleanup. The `/api` masking was found while investigating why `SocialSentimentPanel` showed "Sentiment data unavailable".

**What to monitor / watch for:**
- **Verified live post-deploy (`c1241b5`):** `/api/health`, `/api/v2/status`, `/api/v2/monitor/summary`, `/api/config/flags` all 200; `/api/sentiment/dashboard` 404 JSON; SPA route `/performance` 200; engine running, paper mode.
- **Expect frontend errors to surface that were previously silent.** Any dashboard panel calling an unimplemented endpoint now gets a 404 instead of HTML. This is the intended effect — the failure was already happening, just invisibly.
- **Rollback:** `git revert c1241b5`.

**Known and NOT fixed — needs a decision:**
**66 of the 79 distinct `/api` endpoints the frontend calls are not served by `serverV2.ts`.** The entire `routes/` directory (17 files) is never mounted — it was written for the deleted `server.js`. Only `/api/v2/*`, `/api/health`, and `/api/config/*` are real. Options: mount `routes/` (integration work, those files reference services that may no longer exist), or trim the dashboard to what V2 actually serves. The read-only `/monitor` page is unaffected — it only calls `/api/v2/monitor/summary`.

---

## 2026-07-29 — Repository documentation, cleanup, green CI, history rewrite (NO trading change) — local-claude

**Commits:** squash `b2230a5` (PR #1, 12 task commits) + `1f8b237`, rewritten to `b7e951f` + `fd834d6`
**Files changed:** `README.md`, `LICENSE` (new), `docs/ARCHITECTURE.md` (new), `docs/README.md` (new), `types/services.d.ts` (new), `package.json`, `CLAUDE.md`, `.gitignore`, `.env.example`, `monitor.sh`, `scripts/push-deploy.sh`, `deploy/*`, `docker-compose.yml`, `prometheus/prometheus.yml`, ~40 source files; deleted `server.js`, `server-indicator-service.js`, `canuck-trader-pro/`
**Stats baseline reset:** **no** — no strategy, threshold, gate, sizing rule, or config value was altered.

**What changed:**

*Dead stacks retired (−41,989 lines).* `server.js` (8,141 lines) and `server-indicator-service.js` were imported by nothing — every reference to them was a comment. The Python `canuck-trader-pro/` backend is not run by PM2 and no Node module imports it. `services/` is untouched and remains live; `serverV2.ts` imports it directly.

*157 pre-existing TypeScript errors fixed; CI is green for the first time.* CI had been failing on every run since it was added, because `npx tsc --noEmit` exited 2. Fixed properly — no `tsconfig` relaxation, no `continue-on-error` — so the README's CI badge means what it says. Breakdown: `@types/express`+`@types/cors` (4, plus 10 more via transitive `@types/node`); `types/services.d.ts` ambient declarations for 13 plain-JS `services/` modules (44); `CoreTradingStrategy` for lookup tables typed `Record<TradingStrategy, T>` that define only the original 7 strategies (6); 20 substantive errors; 73 dead declarations.

*Documentation.* `README.md` was unmodified Google AI Studio scaffolding — stock banner, `GEMINI_API_KEY`, wrong project. Replaced. New `LICENSE` (proprietary), `docs/ARCHITECTURE.md`, `docs/README.md`. Every performance figure is quoted from an in-repo source and labelled backtest or paper-trading.

*Drift fixed.* `ecosystem.config.cjs`, `package.json`, and `CLAUDE.md` now agree that the entry point is `serverV2.ts`. Previously all three disagreed.

*Security.* VPS host removed from tracked files **and purged from all 501 commits** via `git filter-repo`; both remotes force-pushed. `monitor.sh`, `scripts/push-deploy.sh`, `deploy/deploy.ps1` now read `$VPS_HOST` from the environment and fail loudly when unset. No credentials were ever committed (verified across the full history).

**Why:**
The repository is being prepared for portfolio / public-facing use. It could not be shown to anyone in its prior state: the README described a different project, three sources disagreed about how to start the system, CI was visibly red, and the live host address was committed.

**What to monitor / watch for:**
- `pm2 status canuck-node` online and `/api/health` returning `ok: true` — **verified post-rewrite** (deployed SHA `fd834d6`, bot restarted cleanly, paper mode, engine running).
- CI should stay green. If `npx tsc --noEmit` ever fails again, it is a real regression now, not background noise.
- **Every commit SHA before 2026-07-29 changed.** SHAs cited in entries below do not resolve. Backup: `cryptogod-backup-2026-07-29.bundle` (verified, outside the repo).
- **`VPS_HOST` must be exported** before running `scripts/push-deploy.sh` or `monitor.sh` — they now fail fast instead of using a hardcoded address.
- **Rollback:** `git clone cryptogod-backup-2026-07-29.bundle` restores pre-rewrite history in full.

**Follow-ups found, not fixed:**
- `v2/index.ts:61-62` says momentum is disabled; `config.ts:257` has `ENABLED: true` (flipped 2026-05-18). Docs follow the executing config. **Momentum is live and a code comment says otherwise.**
- `SocialSentimentPanel` calls `/api/sentiment/dashboard`, which does not exist server-side.
- `deploy/deploy.ps1` Docker mode builds a now-deleted Dockerfile.
- `deploy/setup-vps.sh` retains an unreachable `systemctl is-active trading-bot` branch.

---

## 2026-07-23 — htfRegimes fix, dashboard polish, ATR/shorts analysis (NO config change) — local-claude

**Commits:** `6617d40`
**Files changed:** `v2/engine/tradeEngine.ts`, `v2/dashboard/monitorSummary.ts`, `public/monitor.html`, `docs/reviews/2026-07-23-atr-floor-and-shorts-analysis.md` (new), `CHANGELOG.md`
**Stats baseline reset:** no — no trading-config change.

**What changed:**
`stats.htfRegimes` was declared, typed, and returned by `getV2Status()` but **never assigned anywhere** — so every consumer read `{}` and reported regime `UNKNOWN`. Now populated from `scanResults` (which already carry a per-ticker regime). Additive only; no trading logic touched. If you consume `/api/v2/status`, `htfRegimes` is now non-empty and reflects per-ticker regime.

Dashboard polish: tile values no longer misalign when a label wraps; empty-state table cells lose the row underline and are centred; the header shows the regime spread (e.g. `3×STRONG_DOWN 2×SIDEWAYS 1×DOWN`) instead of a single label — the old code looked up `htfRegimes['BTCUSD']`, but BTC isn't in `SCAN_TICKERS`.

**Analysis shipped (no config change): `docs/reviews/2026-07-23-atr-floor-and-shorts-analysis.md`**
- **ATR floor is NOT costing trades.** 396 regime-gate rejections vs **0** ATR rejections in the recent log window; 591 regime readings, none in `['STRONG_UP','UP']`. The ~2-day drought is a long-only strategy correctly sitting out a bearish tape. **Do not relax `MIN_ATR_PERCENT` to 0.8** — that band is 30% WR / −$1.70 per trade (n=10). This supersedes the "candidate relaxation to 0.8%" note in the 2026-07-21 entry.
- **Do NOT re-enable STRONG_DOWN-only shorts.** Aggregate (+$18.35/27) hides an era split: 2026-05-23→06-04 was 82.4% WR/+$39.15 (n=17), but 2026-06-11→07-14 is 40% WR/**−$20.80** (n=10). All-shorts monthly: May +$5.26, Jun −$10.87, Jul −$22.22. The 2026-07-14 disable was correct and remains correct.
- **Flagged, not shipped:** raise `MIN_ATR_PERCENT` toward 2.0% once trades resume (profit is concentrated in ATR 2–3%: +$77.47/90 @ 64.4%; the 1.0–2.0% band is ~breakeven at −$1.85/104). Also: shorts' recurring `trailing`-exit giveback, and that all six `SCAN_TICKERS` are correlated high-beta alts that gate out simultaneously.

**What to monitor / watch for:**
- `htfRegimes` non-empty in `/api/v2/status`; dashboard header shows a real regime spread, not `UNKNOWN`.
- When regimes turn STRONG_UP/UP, confirm entries resume — that validates the "regime, not ATR" diagnosis.
- **Rollback:** `git revert 6617d40`.

---

## 2026-07-23 — Read-only monitoring dashboard + HTTPS URL — local-claude

**Commits:** `a0ecf29`, `b08fb6b`, `a347106`, `8e5b307`, `f931561`, `aa0e196`, `dc0c890`, merge `672bac7`
**Files changed:** `v2/dashboard/monitorSummary.ts` (new), `v2/dashboard/monitorSummary.test.ts` (new), `v2/dashboard/attributionAPI.ts`, `public/monitor.html` (new), `serverV2.ts`, `v2/engine/tradeEngine.ts`, `vitest.config.ts`, `CHANGELOG.md`
**Stats baseline reset:** no — monitoring/infra change, not a trading-config change.

**What changed:**
New read-only monitoring GUI at **https://VPS-HOST-REDACTED.sslip.io/monitor** (Let's Encrypt cert, HTTP basic-auth, user `admin`). Backed by `GET /api/v2/monitor/summary` on the existing `v2Router`. Single self-contained `public/monitor.html` polls it every 10s. No control actions — the endpoint only SELECTs.

Scope split (deliberate): **headline KPI tiles + equity curve are TREND-only**, matching `getV2Status().portfolioCash` which is TREND-isolated, honoring the repo's contract that sniper P&L is never aggregated with day-trading P&L. **Open/closed trade tables show all strategies**, each row labelled. Cohort filtered by `entry_time >= stats_baseline_time` per the standing rule.

**Engine change (additive only):** added `lastLoopAt` (wall-clock heartbeat) to `stats`, `V2EngineStatus`, and `getV2Status()`, stamped in `runLoop()`'s existing `finally`. `lastLoopTime` keeps its existing meaning (elapsed loop duration) — `scripts/v2-health.mjs`, `components/V2AttributionTab.tsx` and `monitor.sh` all depend on that. No trading logic touched.

Why it was needed: the dashboard's staleness check originally used `lastLoopTime`, which is a *duration*, not a timestamp — so `now - lastLoopTime` always exceeded the 5-min threshold and the health dot would have been permanently red. Caught in final review before deploy.

**VPS infra (one-time, not in repo):**
- nginx reverse proxy, `auth_basic` + `/etc/nginx/.htpasswd` (user `admin`), `proxy_pass http://127.0.0.1:3033`.
- Site file `/etc/nginx/sites-available/monitor`; includes an unauthenticated `location ^~ /.well-known/acme-challenge/ { auth_basic off; root /var/www/html; }` so cert renewal isn't 401'd. Certbot added the 443 block + 80→443 redirect.
- Cert expires 2026-10-21; `certbot renew --dry-run` passes.
- **ufw tightened:** removed public `3033`, `3000`, `3080`. Only `22`, `80`, `443` are internet-reachable. The old dev dashboard on `:3033` is no longer directly accessible — it is now reachable only through the password-gated HTTPS host.

**Why:**
A clean, password-gated monitoring surface without exposing the sprawling 40-panel dev dashboard or a raw `IP:port`. Read-only by design — no route can move money.

**What to monitor / watch for:**
- `https://VPS-HOST-REDACTED.sslip.io/monitor` prompts for password then loads; empty-cohort state renders (0 trades since the 2026-07-22 baseline as of writing).
- Health dot should be GREEN when the engine is looping. If it goes red, check `lastLoopAt` freshness in `/api/v2/status` — that is now a real hang signal, not a display artifact.
- Cert auto-renew before 2026-10-21.
- **Rollback:** `ufw allow 3033/tcp` restores direct access; `rm /etc/nginx/sites-enabled/monitor && systemctl reload nginx` drops the proxy; `git revert 672bac7` removes the code.

**Related observation (not addressed here):** zero entries since the 2026-07-22 baseline (~2 days) under the new ATR ≥ 1.0% floor, engine otherwise healthy. Candidate relaxation to 0.8% was already flagged in the 2026-07-21 entry.

---

## 2026-07-21 — Data-driven overhaul: ATR floor, regime-TF gate, BREAKOUT re-enabled, loss-streak sizing — vps-claude

**Commits:** <this commit>
**Files changed:** `v2/engine/config.ts`, `v2/engine/strategyRunner.ts`, `v2/pipeline/riskGate.ts`, `v2/pipeline/breakoutSignal.ts`, `CHANGELOG.md`
**Stats baseline reset:** yes — new baseline to be set after deploy

**What changed:**
Deep data mining across 574 closed trades revealed several high-impact patterns. Four changes shipped:

1. **ATR >= 1.0% minimum** (was 0.3%): ATR<1% trades had 27.3% WR across 132 trades — a death zone where fee burden dominates. ATR 1-2% = 51.7% WR, 2-3% = 63.5%. This is the single strongest univariate predictor of trade outcome.

2. **UP regime restricted to 4h only for TREND**: UP+1h is a proven loser all-time (n=25, 40% WR, -$1.05/trade). UP+4h has 66.7% WR. STRONG_UP keeps both 1h and 4h (60% WR on both). New `REGIME_TIMEFRAME_RESTRICT` config enforced in strategyRunner.

3. **BREAKOUT re-enabled on 1h/4h**: All-time clean data: 60% WR, +$5.45/trade (n=10). Was disabled Jun 9 after a bad stretch, but now has fee-aware floor + ATR>=1% gate that didn't exist then. Structurally different signal (volume breakout + N-bar high) from TREND.

4. **Loss-streak position reduction**: After 2+ consecutive losses, position size cut 50%. After 4+, cut 75%. Data: post-2-loss trades had 29.3% WR (n=191) vs 62.5% after a win (n=277). Reduces capital exposure during cold streaks.

**Why:**
Current cohort at n=13 has 25% WR, -$37.89 net. Existing TREND strategy has no recoverable edge (+$0.03/trade all-time on 383 trades). Instead of more parameter tweaking, this shifts strategy by cutting proven losing segments and adding a structurally different signal source (BREAKOUT). The loss-streak sizing is a novel finding from inter-trade pattern analysis.

**What to monitor / watch for:**
- ATR filter: should see zero entries with ATR<1%. If too restrictive in low-vol markets, candidate relaxation to 0.8%.
- Regime-TF gate: no 1h TREND entries during UP regime. STRONG_UP 1h entries should still work.
- BREAKOUT trades: track separately. First 10 individually. Expect lower volume than TREND (needs 2x volume + N-bar high).
- Loss-streak sizing: look for `STREAK-REDUCED` in risk gate logs. Confirm position sizes halve after 2 losses.
- Rollback: revert this commit. Each change is independent — can also selectively undo via config.

**Additional data mining findings (not shipped — candidates for future work):**
- Time-of-day edge: hours 22, 8, 12, 15 UTC profitable; hours 0, 14, 23 losers
- TC Value 50-70 is the sweet spot (60% WR, $0.95 avg); TC 30-50 worst zone
- PAIRS engine: 6/6 wins, +$39.70 paper — ready for live discussion (past 30-day paper phase)
- Inter-trade momentum is very strong — system performance is streaky

---

## 2026-07-15 — MR shorts disabled: closes gap left by sprint's shorts-off decision — local-claude

**Commits:** <this commit>
**Files changed:** `v2/engine/config.ts` (MR_CONFIG.SHORTS_ENABLED true→false), `CHANGELOG.md`
**Stats baseline reset:** NO — this is a fix restoring the 2026-07-14 sprint's intended behavior (shorts off cohort-wide), which the standing rule says keeps continuous stats. Baseline stays 1784063502985.

**What changed:**
`MR_CONFIG.SHORTS_ENABLED: false`. Discovery during the queued "MR short regime
constraint" task: the sprint's shorts-disable commit (`c95808d`) only flipped
`V2_CONFIG.SHORTS_ENABLED` (TREND path). MR has its own flag, which stayed true —
**MR shorts were still live post-sprint**, contrary to the sprint review's
assumption that disabling shorts cohort-wide made the MR regime gap moot.

This also resolves the queued regime-gap item: with no short path live anywhere,
there is no unconstrained short entry left. The config comment documents the
decision needed before any re-enable: MR's `ALLOWED_REGIMES` gate is shared by
both sides (`['SIDEWAYS']`), so MR shorts fire in SIDEWAYS by design — which
conflicts with the review's "all shorts are STRONG_DOWN-only" pre-registered
check. A per-side regime policy must be designed first (fading overbought in a
range is the MR thesis, but there's no supporting data; n=1 all-time, -$4.22).

**Verification:**
- Runtime import assert: `MR_CONFIG.SHORTS_ENABLED === false` and
  `V2_CONFIG.SHORTS_ENABLED === false` — no short path enabled anywhere.
- MR short history: 1 trade all-time (TAOUSD, SIDEWAYS, -$4.22). MR longs
  unaffected (9 all-time, -$15.27 — MR's overall viability is a separate
  question for a future review; out of scope here).

**What to monitor / watch for:**
- Zero `side='short'` entries of ANY strategy post-deploy (extends the sprint's
  criterion (b) beyond TREND).
- Rollback: set `MR_CONFIG.SHORTS_ENABLED: true` + redeploy — but read the
  config comment first (per-side regime policy decision required).

## 2026-07-15 — TimeGate extended to MEAN_REVERSION, SNIPER, BREAKOUT — local-claude

**Commits:** <this commit>
**Files changed:** `v2/pipeline/meanReversionSignal.ts`, `v2/pipeline/sniperSignal.ts`, `v2/pipeline/breakoutSignal.ts`, `v2/pipeline/timeGate.ts` (scope comment), `CHANGELOG.md`
**Stats baseline reset:** NO — keeps 1784063502985. Reasoning: this ships one day into the current cohort (n=1 closed trade), within the same tuning-sprint window per the standing rule's "baseline once at the end of a sprint, not per tweak." The change only removes rare entries (MR+SNIPER produced 4 trades total since 2026-06-30, BREAKOUT zero) and does not alter expected outcomes of the dominant TREND flow. Flag to Joseph if he prefers a reset.

**What changed:**
`checkTimeGate` is now called at the top of `detectMeanReversionEntry`,
`detectSniperEntry`, and `detectBreakoutEntry` — same pattern as MOMENTUM
(hard-block hours/days only, no scoreBoost, uses last-candle time so backtests
gate historically). Every v2 entry path is now time-gated.

**Why:**
Follow-up to the investigation entry below. The 2026-07-14 sprint review
expected blocked hours to block all entries; the gate covered only
TREND/MOMENTUM/SCALP. Joseph opted to extend coverage. NOTE: the extension is
mechanistic ("overnight low liquidity"), not data-backed — the 0-7 UTC edge was
measured on TREND+MOMENTUM trades only, and the mechanism arguably fits mean
reversion and new-listing sniping less well. The 3 ungated blocked-hour trades
to date were collectively +$2.56 (n=3).

**Verification:**
- `npx tsc --noEmit` error count unchanged (155 pre-existing, 0 new).
- Runtime script: checkTimeGate blocks hour 1 / allows hour 10; all three
  detectors return null on candles ending in a blocked hour.
- Candle time units audited: krakenAdapter emits ms (`c[0] * 1000`),
  cryptoComAdapter passes through Crypto.com's native ms — no seconds-vs-ms
  hazard that would false-block via a 1970 timestamp.

**What to monitor / watch for:**
- Zero MEAN_REVERSION / SNIPER / BREAKOUT entries during blocked hours (0-7, 13, 20 UTC) post-deploy.
- SNIPER edge case: new listings during the 0-7 UTC window are now unsniped until 08:00 UTC; if a hot listing is missed overnight and that hurts, revisit whether SNIPER should be exempt.
- Rollback: `git revert <this SHA>` + `bash scripts/push-deploy.sh master` (restores ungated behavior for the three strategies only).

## 2026-07-15 — Time-gate "leak" investigation resolved: scope gap, not malfunction — local-claude

**Commits:** <this commit>
**Files changed:** `v2/pipeline/timeGate.ts` (comment only), `docs/reviews/2026-07-14-sprint-review.md`, `CHANGELOG.md`
**Stats baseline reset:** NO — docs/comments only, no behavior change.

**What changed:**
Documentation only. Root-caused the sprint review's "time-gate leak" (3 entries during
blocked hours 0-1 UTC): the gate is functioning correctly for everything it covers.
The 3 trades were SNIPER_CRYPTOCOM ×2 (GROVE_USD) and MEAN_REVERSION ×1 (TAOUSD) —
strategies whose entry detectors never call `checkTimeGate`. Gate call sites are
signalGenerator.ts (TREND long+short), momentumSignal.ts, and scalpSignal.ts only;
breakoutSignal.ts, meanReversionSignal.ts, and sniperSignal.ts are ungated. This
matches the documented 2026-06-30 intent ("blocked for TREND+MOMENTUM entries") —
the sprint review's expectation of a global block was the mismatch.

**Verification details:**
- Zero TREND/MOMENTUM entries during any blocked hour (0-7, 13, 20 UTC) since the
  timegate deploy. 3 apparent TREND hits on 2026-06-30 (01:43, 03:08, 06:15 UTC,
  all ZECUSD 1h) predate the 19:29 UTC deploy of `afeecc4`.
- The 3 ungated blocked-hour trades were collectively +$2.56 (n=3, not meaningful).

**What to monitor / watch for:**
- Nothing from this entry. A follow-up commit extends gate coverage to the ungated
  strategies — see the entry above this one once shipped.

## 2026-07-14 — Profitability sprint: shorts off, 1h time-kill extended, reminder fix — local-claude

**Commits:** `504f75d` (sprint re-review doc), `c95808d` (TREND shorts disabled), `d811c58` (1h time-kill 2→4 bars), `6e7d2cd` (marker-based reminder fix)
**Files changed:** `docs/reviews/2026-07-14-sprint-review.md`, `v2/engine/config.ts`, `v2/pipeline/exitManager.ts`, `scripts/generate-audit-report.mjs`, `CHANGELOG.md`
**Stats baseline reset:** yes — new baseline = 1784063502985 (2026-07-14 21:11:42 UTC, reset immediately after this deploy).

**What changed:**
Four changes shipped together from the `docs/reviews/2026-07-14-sprint-review.md` re-review (baseline 1782834161576, n=38), which superseded the 2026-07-05 n=15 verdict:
1. **Shorts disabled** (`c95808d`) — TREND shorts turned off; every timeframe/regime cell was net negative all-time (-$54 aggregate across the segments reviewed), and post-baseline TREND short 4h was the single worst segment (-$17.99/4).
2. **1h TREND time-kill extended 2→4 bars** (`d811c58`) — Branch A chosen: added a new `timeKillBarsByTf` override so only 1h TREND extends from 2 to 4 bars; 4h TREND time-kill is unchanged, and `STRATEGY_TIMEFRAMES` was left untouched. Based on 3/5 post-baseline 1h TREND `time_kill` exits being recoverable within a 4-bar window (Kraken REST OHLC fallback, since `candle_history` doesn't cover the post-baseline period) — exactly at the 0.6 decision threshold, flagged in the review as low-confidence/provisional on n=5.
3. **GATEKEEPER: defer** — no code change. PROCEED_AB n=5 is far below the n≥30 threshold to act; standard PROCEED path (n=537) remains ~49% win with no measurable edge. Revisit once PROCEED_AB accumulates more samples.
4. **Sprint-review reminder fix** (`6e7d2cd`) — banner now dismisses via a baseline-scoped marker in `audit-batch-notes.md` instead of expiring silently at 30 trades.

**Why:**
See `docs/reviews/2026-07-14-sprint-review.md` for full numbers. Cohort overall expectancy was marginally positive (+$1.56/38, +$0.041/trade) but masked a reversal: trades 1-15 were -$19.44 (-$1.296/trade), trades 16-38 were +$21.00 (+$0.913/trade). Segment analysis on top of that trajectory drove the shorts and 1h decisions above.

**What to monitor / watch for:**
- (a) Expectancy of the new post-baseline cohort > +$0.25/trade at the next 15-trade review.
- (b) Zero `side='short'` TREND entries post-deploy.
- (c) Branch A applies: 1h TREND `time_kill` exit count should drop vs the prior cohort (3 of 5 prior 1h TREND `time_kill` exits were recoverable/premature per the review's recoverability check; 5 of the cohort's 7 time_kills were 1h TREND).
- (d) Rollback: `git revert <task SHA>` for the relevant commit above + `bash scripts/push-deploy.sh master`.
- **Next-sprint candidates flagged (not shipped) by the review — not acted on this batch:**
  - Time-gate leak: 3 entries during nominally-blocked hours 0-1 UTC (GROVE_USD x2, TAOUSD x1), all well after the timegate deploy (`afeecc4`) and the baseline reset — the gate is not fully blocking hour 0-1 for at least these tickers/strategies. Needs a root-cause investigation.
  - MEAN_REVERSION shorts are not constrained to the STRONG_DOWN regime the way TREND/other shorts are (one instance: TAOUSD MEAN_REVERSION short in SIDEWAYS regime, -$4.22). Moot while shorts are globally disabled, but must be fixed before any short path is re-enabled.
  - TAOUSD single-ticker drag (-$36.18/11, -$3.29/trade) — worth a dedicated ticker-level review.

**Follow-up:** baseline recorded above (`1784063502985`) in the `docs(changelog): record baseline <ms>` commit, per the standing rule of a new commit rather than an amend.

**In-flight legacy position (pre-baseline, untouched):** one open position, `60f2be49-ea52-4aad-9533-e090467e3ef0` — ZECUSD TREND long 4h, entered 2026-07-14 19:31 UTC (entry_time 1784057492533, before the new baseline). Left running on its original config per the standing rule — not force-closed. Track its outcome as background data, not part of the new post-baseline cohort.

## 2026-07-14 — Project reference + standing rules restored into CLAUDE.md — user (via local-claude)

**Commits:** <this commit>
**Files changed:** `CLAUDE.md`
**Stats baseline reset:** NO — docs-only change.

**What changed:**
Follow-up to the entry below: the project-specific content (architecture map, dev
commands, Canadian USD-pair compliance, fee thresholds, and the three standing rules —
stats-baseline resets, git hygiene / `push-deploy.sh`, bidirectional changelog) is
back in `CLAUDE.md`, appended as a "Project Reference: CRYPTO_GOD" part after the new
general coding guidelines. The guidelines part is unchanged.

**What to monitor / watch for:**
- Nothing operational. The "recover via git show" pointer in the entry below is now
  moot — the standing rules are in CLAUDE.md again on both machines.

## 2026-07-14 — CLAUDE.md replaced with general LLM coding guidelines — user (via local-claude)

**Commits:** <this commit>
**Files changed:** `CLAUDE.md`
**Stats baseline reset:** NO — docs-only change, no trading behavior affected.

**What changed:**
At the user's direction, `CLAUDE.md` was replaced wholesale with a general LLM
coding-discipline guide (read-before-write, simplicity, surgical diffs, verification,
debugging, dependencies, communication). This applies on BOTH machines — the VPS copy at
`/opt/trading-bot/CLAUDE.md` is this same repo file and updates on deploy.

**Why:**
User request. The new file encodes how Claude should write and change code in this repo.

**What to monitor / watch for (IMPORTANT for VPS Claude):**
- The former CLAUDE.md's project-specific content (architecture map, dev commands,
  Canadian USD-pair compliance, fee thresholds, and the standing rules: stats-baseline
  resets, git hygiene / dual-remote push via `scripts/push-deploy.sh`, and this
  bidirectional changelog) is NO LONGER in CLAUDE.md. Last version with that content:
  the commit before this one (previous CLAUDE.md edit was `3ef6574`); recover via
  `git show <this-commit>^:CLAUDE.md`.
- This changelog file itself still documents the changelog and baseline protocols in
  its header — keep following them; the CLAUDE.md removal was not a revocation of the
  deploy/changelog workflow, just a content swap in CLAUDE.md.
- Rollback: `git revert` this commit and redeploy with `bash scripts/push-deploy.sh`.

## 2026-06-30 — New edge feature: block 0-7 UTC overnight entries — local-claude

**Commits:** <this commit>
**Files changed:** `v2/pipeline/timeGate.ts`
**Stats baseline reset:** NO — continues 1782834161576 (zero closed trades since reset).

**What changed:**
`TIME_GATE_CONFIG.BLOCKED_HOURS` extended from [0,4,13,20] to [0,1,2,3,4,5,6,7,13,20]
— i.e. the entire 0-7 UTC overnight window is now blocked for TREND+MOMENTUM entries.

**Why (this is the new-feature-research win):**
After proving the price-based entry signals contain no recoverable edge (OOS AUC 0.44),
new-feature research found that ENTRY TIME does. On 382 live trades, the 0-7 UTC overnight
window (Asian/pre-London low liquidity) is net-negative and held out-of-sample in BOTH
halves of history (1st half -$0.54/trade, 2nd half -$0.31; good window +$0.71 then +$0.48).
Backtest of the filter:
  - baseline (all): 382 trades, 55% WR, +$96 net, +$0.25/trade
  - skip 0-7 UTC:   273 trades, 59% WR, +$154 net, +$0.56/trade  <- MORE THAN 2x expectancy
This subsumes an apparent "Saturday is bad" effect (Saturday was bad only in its overnight
hours; skipping 0-7 alone beat skipping 0-7 + all of Saturday). Mechanistically sound
(trend-following in illiquid overnight hours), which lowers overfitting risk. BTC market-
regime feature was untestable — BTC candle data is stale at 2026-04-10.

**What to monitor / watch for:**
- No new entries should open 0-7 UTC (`pm2 logs | grep "blocked hour"`).
- Trade frequency drops (10 of 24 hours now blocked + regime gates) — watch it doesn't
  starve like the pre-loosening "1 trade in 9 days". If too sparse, relax 1,2,7 first
  (the marginal hours within the window).
- Per-trade expectancy on the new cohort should run noticeably above the +$0.25 baseline.
- Rollback: restore BLOCKED_HOURS to [0,4,13,20].

---

## 2026-06-30 — ML gatekeeper forward A/B harness — local-claude

**Commits:** <this commit>
**Files changed:** `v2/engine/config.ts`, `v2/engine/tradeEngine.ts`, `v2/attribution/attributionStore.ts`
**Stats baseline reset:** NO — A/B trades are tagged (PROCEED_AB) and separable; gatekeeper-ON arm reflects current config. Continues 1782834161576.

**What changed:**
`GATEKEEPER_AB_TEST: true`, `GATEKEEPER_AB_OFF_RATE: 0.5`. On ~half of loops the ML
gatekeeper is bypassed (OFF arm): all risk-approved signals proceed at 1.0x size. When
an OFF-arm trade executes, we shadow-evaluate what the gatekeeper WOULD have decided; if
it would have BLOCKED, we log a `PROCEED_AB` row so the close handler attaches the
outcome. This measures the gatekeeper's **block-recall** — do the trades it blocks
actually lose? — which is impossible to get retroactively (blocked signals never trade).
Also fixed `resolveGatekeeperByEntry` to match `PROCEED%` only (a trade never follows a
BLOCK; matching BLOCK rows would mis-score them).

**Why:**
The gatekeeper blocks 92% of signals; its approvals win 48% (= baseline, no precision
edge); ml_confidence is saturated. No evidence it helps — but we can't condemn it without
recall data. This experiment generates that data forward. Paper mode (no $ risk); $12
risk cap + MAX_OPEN_POSITIONS=3 bound exposure.

**What to monitor / watch for:**
- `pm2 logs | grep "A/B OFF arm"` should appear ~50% of loops that have signals.
- Decision after ~30 PROCEED_AB samples:
  `SELECT decision, COUNT(*) n, ROUND(100.0*AVG(was_correct),0) win_pct FROM ml_gatekeeper_log WHERE actual_outcome IS NOT NULL AND decision LIKE 'PROCEED%' GROUP BY decision;`
  If PROCEED_AB (would-block) win rate ≈ or > PROCEED (approved), the gatekeeper is
  blocking winners → strong case to remove it. If clearly lower, its blocking is justified.
- Clean-sprint stats: exclude A/B-forced trades by anti-joining v2_trades to PROCEED_AB rows.
- Rollback: `GATEKEEPER_AB_TEST: false` (instantly reverts to normal gatekeeper).

---

## 2026-06-30 — Edge sprint pt2: decouple sizing from confidence + wire ML feedback loop — local-claude

**Commits:** <confidence commit>, <ml commit>
**Files changed:** `v2/engine/config.ts`, `v2/pipeline/riskGate.ts`, `v2/attribution/attributionStore.ts`, `v2/engine/tradeEngine.ts`
**Stats baseline reset:** NO — continues 1782834161576 (still zero closed trades since the reset; one clean sprint).

**What changed:**

1. **Position sizing decoupled from confidence** (`SIZE_BY_CONFIDENCE: false`, flat 0.70).
   The composite confidence score was proven NON-predictive across three independent
   analyses: (a) out-of-sample AUC 0.44 (worse than coin-flip — slightly INVERSE);
   (b) a corrected feature reweight only reached OOS AUC 0.51 (within noise); (c) the
   live signal scorecard shows every signal's standalone edge in ±0.0035 (essentially
   zero). So scaling bet size by confidence bet *more* on slightly-worse trades. The
   flat 0.70 factor (= historical avg confidence) is exposure-neutral and, because the
   profitable .60–.70 confidence band sits *below* average, slightly reallocates size
   toward the better trades. NOT PnL-backtestable from the trade log (can't decompose
   the historical size multiplier) — rests on the AUC evidence + variance argument.

2. **ML gatekeeper feedback loop wired** (`resolveGatekeeperByEntry` in attributionStore,
   called at trade close in tradeEngine). `ml_gatekeeper_log.actual_outcome`/`was_correct`
   were NULL on all 20,757 rows — the gatekeeper's accuracy was never measured. Now each
   closed trade resolves its matching PROCEED decision (sign-correct WIN/LOSS; the existing
   closedTrade.pnlNet omits the short-side multiplier, so this path computes its own).
   A one-time backfill populates history. Pure instrumentation — NO trading-behavior change.

**Why / what the diagnosis found (NOT acted on — needs a real project):**
The edge problem is NOT fixable by recalibration: the current single-timeframe entry
signals (RSI/MACD/BB/TC/etc.) contain no recoverable predictive edge for these assets.
Real edge needs NEW information (HTF context, volatility regime, order-flow). Also: the
ML gatekeeper blocks 92% of signals, its ml_confidence is saturated (≥0.70 on all
approvals), and approved-trade WR is 44% (≤ baseline) — no evidence it adds value, but
block-RECALL is unmeasurable retroactively. **Recommended: run a forward A/B (gatekeeper
on vs off) now that outcomes are tracked, before deciding whether to keep it.**

**What to monitor / watch for:**
- Position sizes should no longer vary with confidence; avg exposure ~unchanged.
- `ml_gatekeeper_log`: `was_correct` should start populating on new closes. Query
  `SELECT decision, COUNT(*), AVG(was_correct) FROM ml_gatekeeper_log WHERE actual_outcome IS NOT NULL GROUP BY decision;`
- Rollback confidence: set `SIZE_BY_CONFIDENCE: true`. Rollback ML: revert the wiring commit (instrumentation only, safe to leave).

---

## 2026-06-30 — Edge sprint: tighten regime gates (shorts→STRONG_DOWN, MOMENTUM→STRONG_UP) — local-claude

**Commits:** <this commit>
**Files changed:** `v2/engine/config.ts`
**Stats baseline reset:** NO — continues the 1782834161576 baseline set earlier today. Zero trades have closed since that reset, so this stays one clean tuning sprint (per CLAUDE.md "baseline once at the end of a sprint, not per tweak").

**What changed:**
Edge/entry-quality diagnosis on 522 trades (filtered to LIVE strategies TREND+MOMENTUM
to exclude disabled SCALP/BREAKOUT/old-MR noise) found the thin edge is a regime-gate
problem. Two gates tightened:

1. **`SHORT_ALLOWED_REGIMES`: ['STRONG_DOWN','DOWN'] → ['STRONG_DOWN'].** 75-trade split:
   STRONG_DOWN shorts 74% WR/+$36; DOWN shorts 65% WR/−$42. Shorts only work in strong
   downtrends; plain DOWN is chop-prone.
2. **`MOMENTUM_CONFIG.ALLOWED_REGIMES`: ['STRONG_UP','UP','SIDEWAYS'] → ['STRONG_UP'].**
   42-trade split: MOMENTUM STRONG_UP 94% WR/+$82 (best setup in the whole system);
   UP 8% WR/−$20; SIDEWAYS −$0.65. MOMENTUM only works in strong uptrends.

**Why:**
After the $12 cap fixed survivability, the remaining problem was edge (~+$0.17/trade).
Diagnosis showed: exits are healthy (trailing captures 91% of peak, don't touch);
sizing now bounded; the leak is taking the right strategy in the wrong regime.

**Open findings (NOT changed — bigger projects, flagged for next sprint):**
- **Confidence score is not predictive above 0.60.** .60–.70 and .70–.80 buckets have
  identical 57% WR but +$107 vs +$3 net; ≥0.80 is negative. Yet confidence scales
  position size. Scoring formula needs rework, or decouple size from confidence.
- **ML gatekeeper feedback loop is dead:** 20,757 decisions logged, blocks 92% of
  signals, but `ml_gatekeeper_log.actual_outcome` / `was_correct` are NULL on every
  row — outcomes are never backfilled, so its value is unmeasured. Fix the backfill
  before trusting/tuning it.

**What to monitor / watch for:**
- No new shorts should open outside STRONG_DOWN; no new MOMENTUM outside STRONG_UP.
- TREND unaffected (still STRONG_UP+UP). MOMENTUM trade frequency will drop (STRONG_UP is rarer).
- Rollback: each config line documents its own revert (re-add 'DOWN' / re-add 'UP','SIDEWAYS').

---

## 2026-06-30 — R:R fix: $12 hard risk cap + shorts restricted to 4h — local-claude

**Commits:** 16df9c0 (risk cap), <this commit> (shorts filter + changelog)
**Files changed:** `v2/engine/config.ts`, `v2/pipeline/riskGate.ts`, `v2/engine/tradeEngine.ts`, `v2/engine/strategyRunner.ts`
**Stats baseline reset:** YES — new baseline = 1782834161576 (2026-06-30 15:42:41 UTC). These change trade-level expected outcomes (position sizing + which shorts fire). No open positions at reset time (clean cohort cut).

**What changed:**
Driven by a 522-trade counterfactual re-sizing backtest of the live trade history
(model validated: realized stop losses = 0.836× predicted risk).

1. **Hard $12 dollar-risk cap** (`MAX_RISK_PER_TRADE_USD: 12`). Effective per-trade
   risk is now `min(equity × 1.5%, $12)`, applied at both sizing sites (riskGate
   pre-ML, tradeEngine post-ML-multiplier). The % cap alone was a ceiling that
   floated to ~$38 of risk on high-ATR names. Backtest: worst single loss
   −$40→−$15, all 9 catastrophic tail losses (>$15) eliminated, per-trade
   volatility −14%, max drawdown lower, net PnL flat-to-up. HIGH conviction
   (pure mechanical tail removal, no curve-fitting).

2. **Shorts restricted to 4h** (`SHORT_TIMEFRAMES: ['4h']`). 1h shorts ran 36% WR
   /−$15.72; 30m shorts 40% WR/−$18.33; 4h shorts 76% WR. Dropping the 1h/30m
   shorts added +$34 net and the best risk-adjusted return in the backtest.
   LOWER conviction — only 16 trades in the dropped sample, could be noise.

Backtest also REFUTED two ideas before they shipped: full risk-parity sizing
(sizes up low-win-rate low-ATR trades → net negative, 2× drawdown) and dropping
low-ATR churn (that bucket was quietly net-positive). Shrink-only capping is the
correct sizing lever.

**Why:**
Every prior cohort showed the same arc (VPS-claude Cycle 68): small trailing wins
(+$2–4) erased by a single −$12 to −$40 stop. Root cause was sizing, not entries:
dollar-risk-at-stop scaled 6× with ATR ($2.80 avg at <1% ATR → $17.56 avg / $37.68
max at ≥4%). The cap makes the downside uniform and small.

**What to monitor / watch for:**
- No single closed trade should lose more than ~$15 net. If one does, the cap
  isn't binding — check `MAX_RISK_PER_TRADE_USD` is applied at both sites.
- `[V2] ... RISK-CAPPED from $X` log lines should appear more often on high-ATR entries.
- No new shorts should open on 1h/30m — only 4h. Existing pre-deploy positions run out on old config.
- Expect lower per-trade $ swings and shallower drawdowns; net/trade expectancy is
  still thin (~+$0.17 baseline) — sizing fixes survivability, not edge. Edge work is the next lever.
- Rollback cap: revert 16df9c0 (or set MAX_RISK_PER_TRADE_USD high, e.g. 9999).
  Rollback shorts filter: set SHORT_TIMEFRAMES to ['1h','4h'].

**VPS deploy action needed:**
```
sqlite3 /opt/trading-bot/data/trading.db "INSERT OR REPLACE INTO settings (key, value) VALUES ('stats_baseline_time', $(date -u +%s%3N));"
```

---

## 2026-06-30 — Fix XTER→TER asset-pair error in Kraken balance pricing — local-claude

**Commits:** (this commit)
**Files changed:** `services/exchangeAdapters/krakenAdapter.js`
**Stats baseline reset:** no — bugfix restoring intended behavior, no trading-config change.

**What changed:**
`getBalance()` normalized Kraken asset codes by stripping any leading `X` followed
by 3 uppercase letters (`/^X(?=[A-Z]{3})/`). That convention is only valid for
Kraken's *legacy* assets (XETH→ETH, XXRP→XRP, XZEC→ZEC…). The live account holds
**XTER** (~432 units, ~$4.58), a modern token whose real name keeps the X — its
only pair is `XTERUSD`. The pattern-strip turned it into `TER`, so the balance
refresh queried the non-existent `TERUSD`/`TERCAD` every hour and logged
`EQuery:Unknown asset pair` (twice/hour since at least 2026-06-29).

Replaced the pattern-strip with an explicit frozen allowlist
`KRAKEN_LEGACY_X_ASSETS` (the 11 known X-prefixed legacy codes). Modern X-named
tokens (XTER, XAUT, XION, XTZ…) now keep their name and price correctly. Verified
against Kraken's `Assets` endpoint (legacy = altname differs from code) and a
normalization unit test over 18 representative assets (0 regressions).

**Why:**
Hourly log spam + XTER showing as unpriced/$0 in account value. The regex couldn't
distinguish `XETH` (strip) from `XTER` (keep) — both are X+3-uppercase — so an
enumerated allowlist is the only correct fix. The same flawed regex still lives in
`fromKrakenPair()` (line ~62) but is latent: it only affects traded pairs and XTER
isn't traded. Left unchanged to keep this a one-change fix; flag for later.

**What to monitor / watch for:**
- `pm2 logs canuck-node | grep "Unknown asset pair"` should stop appearing after deploy.
- Next balance log should show `Asset: XTER → normalized: XTER, base: XTER` and a
  `[Kraken] XTER priced...` (or a successful USD value), not a CAD-fallback warning.
- Rollback: revert this commit (no DB/state change involved).

---

## 2026-06-27 — Aggressive loosening: UP regime + ADX 20 + 1h timeframe — vps-claude

**Commits:** (see below)
**Files changed:** `v2/engine/config.ts`
**Stats baseline reset:** YES — 1782595222099

**What changed:**
Three filters loosened simultaneously — the ADX engine was too selective (1 TREND trade in 9 days):
1. **ALLOWED_REGIMES:** STRONG_UP-only → STRONG_UP + UP. ADX gate still filters weak trends.
2. **ADX threshold:** 25 → 20. Catches emerging trends, not just established ones.
3. **TREND timeframes:** 4h-only → 1h + 4h. More entry windows. 30m stays removed (proven loser).

**Why:**
9 days, 1 TREND trade, 0 MR trades. The triple gate (STRONG_UP + ADX>25 + ML) produced near-zero data. Can't evaluate a strategy that never fires. Joseph requested aggressive approach. Safety nets remain: fee-aware trailing floor (1.56%), ML gatekeeper, 1.5× ATR SL, 1.5% risk cap, correlation check.

**What to monitor:**
- Trade frequency should increase significantly (UP is the most common bullish regime)
- Watch trailing loss rate — UP trades had 44.7% WR pre-fee-floor, should be better now
- If losses accumulate past -$30 in 20 trades, consider reverting UP or raising ADX back to 25
- 1h trades specifically — were -$6.44 net in the fee-floor cohort, may perform differently now
- Rollback: revert this commit

---

## 2026-06-19 — Dual-mode ADX engine: Phase 1 + Phase 2 — local-claude

**Commits:** 949f0d5 (adx indicator), baa6fbd (Phase 1 TREND), 2595ec4 (Phase 2 MR), c80c92a (plan docs)
**Files changed:** v2/indicators/indicators.ts, v2/engine/config.ts, v2/engine/strategyRunner.ts, v2/pipeline/meanReversionSignal.ts, v2/engine/meanReversionEngine.ts, v2/pipeline/meanReversionExitManager.ts
**Stats baseline reset:** YES — set after deploy completes on VPS (see deploy step below)

**What changed:**
Phase 1: TREND now requires ADX>25 AND STRONG_UP regime (previously STRONG_UP OR UP). Timeframes pruned to 4h only (VPS-claude removed 30m on 2026-06-13; local-claude also removed 1h — TAO 1h -$6.41, ZEC 1h -$4.60). Trail activation raised from 1% to 1.4% of TP. ADX gate in strategyRunner.ts filters passedScan per-ticker before generating signals. Note: VPS-claude added TRAIL_ACTIVATE_FEE_FLOOR_MULT=3.0 (1.56% dynamic floor) — that is kept and complements the 1.4% static floor.

Phase 2: Mean Reversion engine rebuilt from 15m long-only (0/4 wins, -$2.80 live) to 1h dual-direction. Primary gate: ADX<20 + SIDEWAYS regime. Long entry: RSI<28 + %B<0.15 + EMA above price. Short entry: RSI>72 + %B>0.85 + EMA below price. Exit: EMA midline TP (binary, no trailing). BAR_MS now dynamic from timeframeToMs(MR_CONFIG.CANDLE_INTERVAL). MR_CONFIG.ENABLED=true; engine boots in v2/index.ts at startup. Same tickers as TREND. Maker both sides (0.32% RT vs TREND's 0.42%).

**Why:**
Root cause of -$25 net on 52 post-baseline trades: EMA10/EMA30 regime detector calls UP in choppy/ranging markets, causing trend-following to fire in mean-reverting conditions. ADX measures trend STRENGTH independent of direction — flips to ranging (<20) much faster than EMA crossover. ADX>25 + STRONG_UP = two independent confirmations required.

**What to monitor / watch for:**
- TREND: trade frequency drops significantly (ADX>25 is selective). Trailing loss rate should fall below 25% of trailing exits.
- MR: heartbeat logs `[MR] Loop #N:` every 60s in pm2 logs. First 10 MR trades individually — confirm WR ≥60%, avg winner ≥+$3.50 net.
- BOTH: if MR engine errors on boot, check `pm2 logs canuck-node | grep '\[MR\]'` — any `[MR] Loop error:` lines need immediate attention.
- Rollback Phase 2: set `MR_CONFIG.ENABLED: false` in config.ts, push. No DB changes needed.
- Rollback Phase 1: revert STRATEGY_TIMEFRAMES.TREND, ALLOWED_REGIMES, trailActivatePercent.

**VPS deploy action needed:**
After deploy completes, reset stats baseline:
```
sqlite3 /opt/trading-bot/data/trading.db "INSERT OR REPLACE INTO settings (key, value) VALUES ('stats_baseline_time', $(date -u +%s%3N));"
```

---

## 2026-06-13 17:10 UTC — Fee-aware trailing floor + 30m removal — vps-claude

**Commits:** 0c909b0
**Files changed:** `v2/engine/config.ts`, `v2/pipeline/exitManager.ts`
**Stats baseline reset:** YES — new baseline 1781370610019

**What changed:**
1. **Fee-aware trailing activation floor** (from local-claude branch `fix/fee-aware-trail-activation`, commit c596902). Trailing activation floored at `FEE_ROUND_TRIP_TAKER × TRAIL_ACTIVATE_FEE_FLOOR_MULT` (0.52% × 3 = 1.56%). Both previous fixed values failed: 2.5% caused 20 SLs at -$11 avg; 1% caused trailing wins of +$1.55 below the $1.90 fee floor (red flag tripped at 11 trailing exits). The fee multiple self-scales across timeframes/ATR.

2. **Removed 30m from TREND timeframes.** Post-baseline data: 4 trades, 1 win, -$21.29. The 30m granularity triggers trailing on noise that 1h/4h would filter. 4h was 11 trades, 10 wins, +$13.70. 30m accounted for 100% of the cohort's net loss.

**Why:**
20-trade threshold reached. Joseph signed off on both changes. The trailing red flag (avg win +$1.88 < $1.90 fee floor) confirmed the 1% activation was too tight. The fee-aware floor ensures trailing wins clear fees by construction (~1.8× fees at worst case).

**What to monitor:**
- Trailing wins should now avg above $1.90 (floor prevents sub-fee activation)
- 30m entries should stop appearing — only 1h and 4h for TREND
- MOMENTUM keeps 1h+4h — its first trade was +$5.83 (best in cohort)
- If trailing win avg drops below $2.50 after 10+ trades, the 3× floor may need raising
- Rollback: revert this commit for both changes

---

## 2026-06-12 15:15 UTC — VPS inner .git resynced + deploy hook now self-syncs it — local-claude

**Commits:** (this commit — docs only; the hook lives on the VPS at `/opt/trading-bot.git/hooks/post-receive`, not in the repo)
**Files changed:** CHANGELOG.md only (repo); on VPS: `/opt/trading-bot.git/hooks/post-receive` patched, original backed up to `post-receive.bak-2026-06-12`
**Stats baseline reset:** no — no trading-behavior change.

**What changed:**
One-time fix: `/opt/trading-bot/.git` (the work-tree repo VPS Claude commits from) was stale at `27765ee` while deployed files were at `897ec61` — the post-receive hook's `GIT_WORK_TREE=... git checkout -f` updates files but never the inner repo. Verified fast-forward ancestry, then `git fetch vps master` + `git reset --mixed` brought the inner master/index to the deployed SHA without touching working files (only expected diff afterward: `dist/index.html`, the VPS-built artifact). Root-cause fix: the hook now syncs the inner `.git` to the deployed SHA on every push (unsets `GIT_DIR`, fetches from the bare repo, resets if on master / force-moves the master ref otherwise; non-fatal on failure).

**Why:**
This exact staleness caused the May 2026 branch-divergence incident — VPS commits built on a pre-pairs base, force-moving master and silently dropping the pairs engine for ~10 days. The hook guaranteed recurrence on every deploy.

**What to monitor / watch for:**
- VPS Claude: before committing on the VPS, `git log --oneline -1` should match `/opt/trading-bot.git` master. If it ever doesn't, the hook sync failed — check `logs/deploy.log` for "inner .git sync failed".
- Next deploy's `logs/deploy.log` should show the fetch/reset lines between checkout and npm install.
- Rollback: `cp /opt/trading-bot.git/hooks/post-receive.bak-2026-06-12 /opt/trading-bot.git/hooks/post-receive`.
- Note: this entry is pushed to origin only (a vps push just for docs would pointlessly restart the bot); it reaches the VPS with the next real deploy.

---

## 2026-06-11 16:00 UTC — Monitoring made cron-driven: audit report generator + agent nudges — local-claude

**Commits:** (this commit)
**Files changed:** scripts/generate-audit-report.mjs (new), scripts/vps-nudge-agent.sh (new), docs/VPS-AGENT.md (§5c item 7 rewritten, §5d added)
**Stats baseline reset:** no — monitoring/docs only, no trading-behavior change.

**What changed:**
The audit-batch progress report (`data/reports/audit-batch-progress.md`) is now generated hourly by cron via `scripts/generate-audit-report.mjs` — deterministic SQLite queries, no LLM. It computes cohort comparison, exit mix, MOMENTUM tracking, pairs status, and the trailing red-flag check (avg trailing win vs $1.90 fee floor at 10+ samples) in code. VPS Claude's narrative moves to `data/reports/audit-batch-notes.md`, included verbatim at the report's bottom. A second cron (`scripts/vps-nudge-agent.sh`, every 6h) sends a monitoring-cycle prompt into VPS Claude's tmux session. Root crontab on the VPS gained both entries (hourly report at :05, nudge at 0 */6).

**Why:**
On 2026-06-11 the progress report was found 34h stale with only 3 of 11 post-baseline trades captured, and `agent-log.md` had no June entries. Root cause: VPS Claude is an interactive tmux session with NO recurring driver — it ran one cycle on Jun 10 and then idled at its prompt. Joseph expects this report current on demand (VPS-AGENT.md §5c); report freshness can't depend on an LLM remembering to wake up.

**What to monitor / watch for:**
- `data/reports/audit-batch-progress.md` "Generated:" timestamp should never be > ~70 min old. If stale: check root `crontab -l` and `logs/audit-report-cron.log`.
- VPS Claude (you, if you're reading this there): do NOT edit audit-batch-progress.md directly anymore — write narrative to audit-batch-notes.md. See VPS-AGENT.md §5c/§5d.
- Nudge delivery: `logs/nudge.log` on VPS; "Scheduled monitoring cycle" messages should appear in the tmux session every 6h.
- Trailing red flag (as of 2026-06-11 16:00 UTC): 9 trailing exits, avg trailing WIN +$1.70 — BELOW the $1.90 floor but under the 10-sample minimum. One more trailing exit decides it. Do not retune without 20+ trades (standing rule); report it.
- Rollback: delete the two crontab lines + `git revert` this commit.

---

## 2026-06-09 — Branch divergence healed + full-audit fix batch (16 findings) — local-claude

**Commits:** merge `27765ee` into master, then `b37171e`, `449ddf3`, `0ce729e`, `c922d61`, `04c4387`, `4078477`, `f95362b`, `6b8e2ca`, `91c9fa2`
**Files changed:** v2/engine/, v2/pipeline/, v2/pairs/, v2/backtest/, v2/attribution/, routes/, services/database.js, services/correlationRiskBackend.js, scripts/backtest-v2.ts
**Stats baseline reset:** YES — new baseline set on deploy (see settings.stats_baseline_time). Material changes: trailing activation 2.5%→1% (TREND), per-strategy time-kills now active, ML sizing capped, BREAKOUT disabled, pairs fees corrected.

### IMPORTANT: branch divergence (read this, VPS Claude)

VPS Claude's 10 commits (2026-05-27 → 06-06, `ef5065c`..`27765ee`) were built on `3632c2b`, a base from BEFORE the 2026-05-26 pairs deployment, and VPS `master` was force-moved onto that line. Result: **the VPS ran without the pairs engine, the `11c8f5a` loop fix, and the backtest harness from 05-27 to today** (confirmed: `v2_pairs_state` rows stop ~05-27). This deploy merges both lines — nothing was lost, but always `git pull` / branch from the deployed master before committing on the VPS, and add changelog entries (the 10 tuning commits had none).

### What changed (by priority)

1. **Exit-config wiring (`449ddf3`)** — exitManager only reads `STRATEGY_EXIT_CONFIGS`; tuned values in `V2_CONFIG` were dead. TREND now actually trails at 1% (was silently 2.5%); per-strategy time-kill/quick-kill now scale `bars × entry timeframe` via a new persisted `timeframe` column (old rows keep global 6h/4h timers); break-even stop clamped to the valid side of price (was booking phantom paper profits on high-ATR tickers); live executor uses per-strategy SL/TP + real strategy tag; dual-engine peakPrice now updates.
2. **Risk path (`0ce729e`)** — ML sizeMultiplier re-capped at MAX_RISK_PER_TRADE_PERCENT (was breaching the 06-06 1.5% cap by up to 50%); riskGate fee-floor uses per-strategy TP; signal/risk matched by ticker+side; live rollback cancels the native SL.
3. **BREAKOUT disabled (`b37171e`)** — 2/12 wins, -$50.28 post-baseline.
4. **Security (`4078477`)** — session start/stop/pause/resume/restore, /api/db/* writes, pairs force-close, dual/bearish start/stop now require admin auth (localhost exempt; ADMIN_API_KEY deliberately unset = remote default-deny).
5. **Pairs engine (`6b8e2ca`)** — fees were undercounted 2× (round trip = 4 executions); kill-switch pause/loss-counter persisted across restarts; time-stop works for adopted trades; stale-candle freshness gate; paper fills at next-bar open (backtest semantics). **All prior pairs paper PnL was overstated by ~$2.60 per $1K round trip.**
6. **Backtest realism (`91c9fa2`)** — intra-bar ordering now pessimistic by default (adverse extreme first); gap-through opens fill at the open; 30m no longer silently maps to 15m. **Re-validate the 6-ticker concentration, no-cooldown, and 30m decisions against the pessimistic default before trusting their numbers** — live data already contradicts the in-sample claims (AKT picked at "93.3% WR" is 1/4 wins live; PENGU 2/5; PENDLE 0/2).
7. **DB/infra (`f95362b`, `c922d61`, `04c4387`)** — dashboard correlation matrix unbroken (`timestamp`→`time` column bug); v2_pairs_state/alerts added to 90-day retention sweeps; UPDATE-builder column allowlists; equity from SQL SUM not last-1000 page; candle fetches chunked + TTL-jittered.

### Why

Fee drag and exit-config drift, measured live: post-baseline gross +$152.30 vs $127.93 fees = +$24.36 net (84% eaten); avg stop -$11.10 vs avg trailing win +$3.14; stops erased 86% of winners' PnL. The tuning that was supposed to fix this (1% trailing, 1.5% risk cap) was either dead config or being silently undone by the ML multiplier.

### What to monitor / watch for

- Trailing exits should activate earlier: expect more `trailing` exits with smaller avg size, fewer `time_kill`/`stop_loss`. If win SIZE collapses below fee floor (~$1.9 on $360), the 1% activation is too tight — candidate revert is `449ddf3`'s config line only.
- MOMENTUM trades should now hold up to ~2.7 days on 4h (watch `time_kill` reasons mention the per-strategy threshold).
- `[V2] ML SIZE REJECT` log lines = ML multiplier hitting the new floor (expected occasionally).
- Pairs (re-enabled by this deploy, paper mode): expect FEWER profitable-looking trades now fees are honest. `pairs_consecutive_losses`/`pairs_paused_until` keys in settings must survive restarts.
- `[V2 Candles] N/24 fetches failed` warnings = Kraken rate-limit pressure; if persistent, raise CHUNK_GAP_MS.
- Rollback: each numbered item is one commit — `git revert <SHA>` individually.

---

## 2026-05-26 18:00 UTC — Pairs trading engine deployed in PAPER MODE — local-claude

**Commits:** merge commit of `feat/canonical-strategy-backtest` (commits `ab1ae8e` through `557afc9`) + ecosystem config update
**Files changed:** 30+ new files under `v2/pairs/`, `v2/backtest/canonical/`, `components/PairsTradingPanel.tsx`, `containers/TabLayout.tsx`, `services/exchangeAdapters/krakenAdapter.js` (margin order methods added), `ecosystem.config.cjs` (PAIRS_MODE=paper added)
**Stats baseline reset:** NO (paper-mode trades on a separate strategy; do not affect TREND/MOMENTUM/BREAKOUT baseline)

### What changed

Added cross-asset pairs trading engine. Strategy #11 from the canonical 20-strategy blueprint. Survived walk-forward validation with the strongest fragility ratio in the entire study (FIL/ICP: IS +2.79% → OOS +11.28%, fragility 4.05).

**Engine config (live PAIRS_CONFIG):**
- Pair: FILUSD / ICPUSD
- Entry: |z| ≥ 1.5σ; Exit: |z| < 0.3σ; Stop: |z| > 4σ
- β re-estimate every 120 bars; 720-bar rolling window
- Notional: $1000 total ($500/leg)
- Time stop: 200 bars (~8 days on 1h)
- 3-loss auto-pause; 3% drawdown kill; ADF gate at t > -2.86

**SAFETY INTERLOCK:** Engine mode is gated by `PAIRS_MODE` env var:
- `off` (default if env unset) — engine doesn't run
- `paper` — signals fire, all fills simulated, NO orders to Kraken
- `live` — requires SECOND env var `PAIRS_LIVE_CONFIRMED=yes`. Without that, downgraded to paper.

VPS ecosystem.config.cjs now sets `PAIRS_MODE=paper`. NEVER set `PAIRS_LIVE_CONFIRMED=yes` on VPS without explicit operator sign-off — Phase A protocol calls for 30 days of paper data first.

### Why

Backtest validated FIL/ICP as the highest-confidence edge in the canonical 20-strategy study. Walk-forward survival (OOS > IS) is the rare signature of a genuine structural edge rather than overfitting. Now starting Phase A: 30 days of paper-mode signals to confirm live behavior matches backtest before risking real capital.

Expected paper-mode results (per most recent 30/60/90d backtest using live config — see `v2/backtest/canonical/pairs/results/expected-latest.md`):

| Window | Trades | WR | PF | Net % | Max DD |
|---|---:|---:|---:|---:|---:|
| 30d | 7 | 85.7% | 17.27 | +25.06% | 1.54% |
| 60d | 9 | 66.7% | 6.22 | +21.22% | 4.07% |
| 90d | 28 | 50.0% | 1.89 | +19.87% | 14.70% |

Expect **1-2 trades per week, $35-$8 per trade net, 5-15% max DD over a month**.

### What to monitor (VPS Claude — every cycle)

1. PM2 process: `canuck-node` should be `online`. Look for `[PAIRS] engine initialized (mode=paper, pair=FILUSD/ICPUSD)` in startup logs.
2. Loop heartbeat: `[PAIRS] cointegration initialized β=... adf=...` line should appear within 60s of restart, then `[PAIRS] no entry — z=X.XX within ±1.5` or signal logs every loop.
3. Cointegration health: ADF t-stat should stay below -2.86 in `v2_pairs_state` snapshots. Alert if t > -2.0 (already triggers internal alert).
4. New paper trades: query `v2_pairs_trades WHERE mode='paper' ORDER BY entry_time DESC LIMIT 5`.
5. Recent alerts: `v2_pairs_alerts ORDER BY created_at DESC LIMIT 10` — anything `crit` severity needs human review.

### What to write into the rolling status report

Generate/maintain `data/reports/pairs-status.md` on every cycle. Sections:
- Header (timestamp, mode, loop count, ADF healthy y/n)
- Cointegration snapshot (β, α, R², ADF, halflife — read from latest `v2_pairs_state` row)
- Open trade (if any) with unrealized PnL — call `/api/v2/pairs/status` or query DB
- Paper cumulative PnL over the Phase A window
- Recent 10 alerts
- Days remaining in Phase A
- Phase A success criteria progress (≥3 signals, ≥+1% PnL, etc.)

### Rollback

Set `PAIRS_MODE=off` in ecosystem.config.cjs, push, restart. Or just don't push the new config — the engine is OFF if env var unset. Existing TREND/MOMENTUM/BREAKOUT engines are completely independent.

### Cross-references

- Deployment plan: `docs/plans/2026-05-26-pairs-deployment-plan.md`
- Operational runbook: `docs/runbooks/pairs-runbook.md`
- Expected behavior backtest: `v2/backtest/canonical/pairs/results/expected-latest.md`
- API endpoints: `GET /api/v2/pairs/{status,trades,state,pnl,alerts}`, `POST /api/v2/pairs/force-close`
- Dashboard: F8 tab on the React UI

---

## 2026-05-26 13:40 UTC — Historical dedup of v2_trades + baseline reset — local-claude

**Commits:** none (data-only operation on VPS sqlite, no code change)
**Files changed:** `data/trading.db` (on VPS) — backed up to `data/trading.db.bak-20260526-133821` (2.8 GB)
**Stats baseline reset:** YES — new baseline `1779802737790` = 2026-05-26 13:38:57 UTC (old baseline was `1778081226430` = 2026-05-06 15:27 UTC)

### What changed
Marked 78 duplicate rows in `v2_trades` as `status='duplicate'` (previously `'closed'`). For each `(strategy, ticker, entry_price, exit_price)` cluster on BREAKOUT/MOMENTUM/SCALP with 59s avg gap, kept the row with the earliest `entry_time` and marked the rest as duplicate. TREND/SNIPER/MR untouched (no bug on those paths).

| Strategy | Rows marked |
|---|---:|
| BREAKOUT | 13 |
| MOMENTUM | 29 |
| SCALP | 36 |
| **Total** | **78** |

Then reset `stats_baseline_time` so post-baseline reports filter to post-fix trading only.

### What the dedup revealed (all-time, deduplicated)
| Strategy | Trades | Wins | WR | Net | Avg/trade |
|---|---:|---:|---:|---:|---:|
| BREAKOUT | 10 | 6 | 60.0% | +$54.47 | +$5.45 |
| TREND | 160 | 76 | 47.5% | +$8.43 | +$0.05 |
| SNIPER_KRAKEN | 7 | 3 | 42.9% | +$2.98 | +$0.43 |
| MOMENTUM | 13 | 2 | 15.4% | -$2.39 | -$0.18 |
| MEAN_REVERSION | 8 | 0 | 0% | -$16.16 | -$2.02 |
| SCALP | 50 | 9 | 18.0% | -$37.23 | -$0.75 |

The earlier "post-baseline +$175, MOMENTUM +$64" was inflated by the dup bug. **MOMENTUM's apparent profit was almost entirely the ZECUSD 16-row cluster** at +$10.99 × 16 = ~+$176 of phantom PnL. Real MOMENTUM = 15% WR, slightly negative — same shape as MEAN_REVERSION/SCALP (already disabled). **Only BREAKOUT shows a clean positive signal** (60% WR, +$5.45/trade). **TREND is barely break-even** post-baseline (averaged +$0.05/trade across 160 trades) — its earlier headline numbers also benefited from one dup cluster being filtered out.

### Implications for next tuning sprint
1. **MOMENTUM is a candidate for disable** — its post-dedup numbers look like SCALP/MR (15% WR, negative). The 88cf359 confidence gate + sizing cap hasn't been enough. Consider disabling or doing another optimization sweep before live-running.
2. **TREND edge is thinner than it looked** — 160 trades at +$0.05/trade is barely above noise. Worth re-running a backtest against the deduped live data to see if the live-vs-backtest gap is real.
3. **BREAKOUT is the only clear earner** — small sample (10) but 60% WR is encouraging. Worth a separate post-mortem on the 6 winners to identify the pattern.

### How dedup was performed
```sql
BEGIN;
UPDATE v2_trades SET status = 'duplicate'
WHERE id IN (
  SELECT id FROM v2_trades AS t
  WHERE status = 'closed' AND exit_price IS NOT NULL
    AND strategy IN ('BREAKOUT','MOMENTUM','SCALP')
    AND entry_time > (
      SELECT MIN(entry_time) FROM v2_trades
      WHERE strategy = t.strategy AND ticker = t.ticker
        AND entry_price = t.entry_price AND exit_price = t.exit_price
        AND status IN ('closed','duplicate')
    )
);
COMMIT;
```

### Rollback
Restore from `data/trading.db.bak-20260526-133821` (2.8 GB backup taken pre-dedup). To revert the baseline only without dedup rollback: `INSERT OR REPLACE INTO settings (key, value) VALUES ('stats_baseline_time', '1778081226430');`

### What to monitor
- Reports filtering by post-baseline should now show only post-fix trades — should start at near-zero and accumulate from 2026-05-26 13:38:57 UTC forward.
- Engine code treats `status` as 'open' / 'closed' (and now 'duplicate'). Verify no queries assume status IN ('open','closed') only and silently drop these (intended) or include them (bug). Quick check: `grep -r "status.*=.*'closed'" v2/` to see if anything counts on dedupd rows.

---

## 2026-05-26 13:30 UTC — Fix: V2 loop crash (`passedScan is not defined`) + restore per-candle entry guard — local-claude

**Commits:** (this commit; restores 7b0fc2e from yesterday's session that was dropped by a reset+pull)
**Files changed:** `v2/engine/tradeEngine.ts`, `v2/engine/breakoutEngine.ts`, `v2/engine/momentumEngine.ts`, `v2/engine/meanReversionEngine.ts`
**Stats baseline reset:** NO (bug fix restoring intended behavior; per the standing rule, no reset for fixes that restore intent)

### The crash
Every V2 loop has been throwing `ReferenceError: passedScan is not defined` at `tradeEngine.ts:472` since at least ~05:30 UTC today. PM2 reported `online` (40h uptime) but the trade-loop callback failed every iteration — classic silent-failure-under-PM2 pattern (same shape as the 3-day `2a96f56` brace bug). Three positions opened at 05:05–05:21 UTC (FETUSD long, HYPEUSD short, ZECUSD short) sat with no managed exits running for ~8h before this fix.

### Root cause
The multi-timeframe rebuild (`2b69581`, 2026-05-18) renamed `passedScan` → `scanResults` in `tradeEngine.runLoop` but missed the diagnostic log line on what is now line 472. That log fires only in the **else** branch where risk rejects all signals — so the bug slept for 8 days. Today's quieter market hit that branch consistently and the crash became continuous.

### The fix
One-line: `passedScan.length` → `scanResults.filter(r => r.passed).length` (preserves the original semantic — count of tickers that passed the market scan).

### Also restored: per-candle entry guard (originally commit 7b0fc2e, dropped by reset+pull yesterday)
Yesterday's local session shipped a per-candle entry guard on `breakoutEngine.ts`/`momentumEngine.ts`/`meanReversionEngine.ts` and then accidentally reset it out before pushing. The reflog had the commit dangling; this commit restores it.

#### The dup-trade bug it fixes
Systemic duplicate rows in `v2_trades` for BREAKOUT, MOMENTUM, SCALP (TREND/SNIPER/MR clean). Pattern: identical `(ticker, entry_price, exit_price)` with avg 59-second gap = `BOT_LOOP_INTERVAL_MS - 1s`. Worst case: MOMENTUM/ZECUSD @ $562.33 → 16 dup rows over 16 min.

| Strategy | Reported rows | Unique trades | Inflation |
|---|---|---|---|
| BREAKOUT | 22 | 9 | 2.4× |
| MOMENTUM | 32 | 5 | 6.4× |
| SCALP | 86 | 50 | 1.7× |
| TREND | 32 | 32 | clean |

BREAKOUT's reported +$86.86 net was really ~+$36.93. MOMENTUM's headline numbers were ~6× inflated. SCALP's negative-PnL conclusion is unchanged but per-trade economics differ. TREND Config A live PF=1.64 is real (TREND path doesn't have the bug).

#### Root cause of dup-trade
Satellite engines record entries at `signal.signals.close_price` (prior candle close) and exit at live price. In paper/shadow mode `insertTrade` simulates an instant fill, so when live price has already moved past TP/SL relative to the prior candle close, the trade opens and closes within the same loop iteration. The existing `if (currentBO.some(t => t.ticker === ticker)) continue` guard doesn't help because the trade has already closed before the guard is evaluated next loop. Result: re-entry every loop until the candle rolls. TREND avoids this because it runs through `tradeEngine.ts:executeTrade()` with Risk + ML gating on 4h candles.

#### The guard (5 LOC per engine)
Per-engine module-scope `Map<string, number>` of last-traded candle `time` per ticker; refuse new entry until candle.time advances; set after successful `insertTrade`.

### What to monitor (after deploy)
- **Loop should run clean** — `[V2] Loop #N: ...` lines streaming every 60s, no `passedScan is not defined`.
- **3 stranded positions** (FETUSD long, HYPEUSD short, ZECUSD short opened 2026-05-26 05:05–05:21 UTC) should resume managed exit handling on first clean loop. Watch for trail/SL/TP/time_kill activity on them.
- **Dup-trade query after 2-4h** — no new clusters with 59s avg gap:
  ```sql
  SELECT strategy, ticker, entry_price,
         (MAX(entry_time)-MIN(entry_time))/(COUNT(*)-1)/1000 AS avg_gap_sec,
         COUNT(*) AS rows
  FROM v2_trades
  WHERE entry_time >= <deploy_epoch_ms> AND status='closed'
  GROUP BY strategy, ticker, entry_price, exit_price
  HAVING COUNT(*) > 1;
  ```
- **Side effect**: legitimate same-ticker re-entries on BO/MOM/MR must now wait for next candle bar (1h for BO, 4h for MOM, 5m for MR). Trade-count drops are expected and were artifacts.

### Rollback
Revert this single commit. Both fixes are self-contained and additive.

### Followups
- Historical dedup of `v2_trades`: mark dup rows as `status='duplicate'` (separate change).
- After dedup: reset `stats_baseline_time`.
- SCALP lives in `services/multiAgentSystem.js` (different code path) and is currently disabled — same dup symptom there if re-enabled.
- Defensive: consider a watchdog that counts consecutive loop errors and hard-exits so PM2 restarts cleanly (would have caught this in minutes, not hours).

---

## 2026-05-18 — Multi-timeframe multi-strategy architecture — vps-claude

**Commits:** `2b69581`
**Files changed:** `v2/engine/candleManager.ts` (new), `v2/engine/strategyRunner.ts` (new), `v2/pipeline/scalpSignal.ts` (new), `v2/engine/config.ts`, `v2/engine/tradeEngine.ts`, `v2/pipeline/exitManager.ts`, `v2/index.ts`
**Stats baseline reset:** no

**What changed:**
Major architectural rebuild. The bot now runs 5 strategies across 6 timeframes:
- **TREND** (1h, 4h): Composite score with maturity penalty
- **MOMENTUM** (1h, 4h): Z-score spike + higher-highs
- **BREAKOUT** (15m, 1h): N-bar high breakout + volume confirmation
- **MEAN_REVERSION** (5m, 15m): RSI<30 + BB oversold
- **SCALP** (1m, 5m): RSI pullback for quick entries

New infrastructure:
- `candleManager.ts`: Staggered multi-TF candle fetching (fast TFs every 60s, slow every 15min)
- `strategyRunner.ts`: Runs all strategies on optimal TFs, collects + ranks signals
- Per-strategy exit configs (SL/TP/trailing/time-kill scaled to each strategy)
- Shorts integrated into strategy runner (no separate pipeline)

**What to monitor / watch for:**
- `[V2] Loop #N: X signals: [...]` — shows which strategies/TFs are firing
- More diverse trade strategies in DB (check `strategy` column)
- API rate limits: stagger should keep Kraken calls manageable
- If a strategy produces bad trades, disable by removing from STRATEGY_TIMEFRAMES

---

## 2026-05-18 — MOMENTUM rebuilt + shorts enabled — vps-claude

**Commits:** `36fc293`
**Files changed:** `v2/engine/tradeEngine.ts`, `v2/engine/config.ts`, `v2/pipeline/executor.ts`, `v2/index.ts`, `v2/backtest/backtestEngine.ts`
**Stats baseline reset:** no

**What changed:**
1. **MOMENTUM rebuilt from ground up.** No longer runs a separate engine loop — momentum z-score spike detection now runs as Stage 2b in the main tradeEngine pipeline. Gets all guards for free: cooldown, correlation, maturity, risk-based sizing, improved exitManager. The old separate momentumEngine/momentumExitManager are no longer started.
2. **SHORTS_ENABLED = true.** Paper mode only (guarded in executor). Bot can now enter short positions in DOWN/STRONG_DOWN regimes.
3. **SCAN_TICKERS expanded:** Added RUNE, ENA, KAS, ICP (momentum tickers) to the main scan.
4. **Backtest supports MOMENTUM entries** — tries momentum z-score detection when TREND entry doesn't fire.

**What to monitor / watch for:**
- `[V2] MOM signal:` log messages when momentum fires
- `[V2] SHORT opened:` log messages when shorts fire
- MOMENTUM trades tagged as strategy='MOMENTUM' in DB
- Short trades have side='short' — exitManager handles inverted SL/TP/trailing
- If momentum produces too many low-quality entries, raise MIN_CONFIDENCE from 0.70 to 0.75
- Rollback: set MOMENTUM_CONFIG.ENABLED=false and SHORTS_ENABLED=false

---

## 2026-05-18 — 6-feature enhancement sweep — vps-claude

**Commits:** `d7c4bd1`, `83ec8ed`, `de864c3`, `046d9f2`, `b556f68`, `88cf359`
**Files changed:** 11 files across v2/pipeline/, v2/engine/, v2/indicators/, v2/attribution/, v2/backtest/
**Stats baseline reset:** no (features disabled by default, paper-test first)

**What changed:**
1. **Re-entry cooldown** (d7c4bd1): 8h cooldown per ticker after exit. Backtest: PF 1.10→1.13, trades 356→301, DD -$135→-$118.
2. **Correlation check** (83ec8ed): Gate 4.5 rejects entries when avg Pearson corr > 0.70 with open positions. Portfolio-level guard.
3. **Trailing giveback** (de864c3): Loose-early/tight-late profile — 1.5x giveback when profit near activation, tightens as profit grows.
4. **Trend maturity** (046d9f2): 0-100 score on RegimeResult (consecutive bars + RSI extremeness + EMA distance). Penalizes exhausted trends by up to 15 points. Avg win +$6.73→+$7.14.
5. **Short selling** (b556f68): Full pipeline support — scanner, signals, riskGate, executor, exitManager, backtest. SHORTS_ENABLED=false by default. Paper mode only guard.
6. **MOMENTUM fix** (88cf359): Added MIN_CONFIDENCE=0.70 gate + risk-based sizing cap. ENABLED=false pending backtest.

**What to monitor / watch for:**
- Re-entry cooldown: `[V2] RISK REJECT ... Re-entry cooldown` in logs
- Correlation: `[V2] RISK REJECT ... Correlated: avg rho=X.XX` when 2+ positions open
- Trend maturity: `maturity=XX(-Y)` in signal PASS/REJECT messages
- Short selling: disabled (SHORTS_ENABLED=false). Enable with config change + restart after backtest.
- MOMENTUM: disabled (ENABLED=false). Enable after backtest validates PF>1.

---

## 2026-05-17 — Add SOL, HYPE, SUI, LINK to SCAN_TICKERS — vps-claude

**Commits:** (see below)
**Files changed:** `v2/engine/config.ts`
**Stats baseline reset:** no

**What changed:**
Added 4 tickers to TREND SCAN_TICKERS: SOLUSD, HYPEUSD, SUIUSD, LINKUSD. Scan goes from 3 → 7 tickers.

**Why:**
Bot had zero trades for 3 days — all 3 existing tickers (AKT, ZEC, COMP) were in DOWN/STRONG_DOWN regime. These are correlated mid-cap alts that all move together. Adding higher-vol, differently-correlated assets gives the regime gate more chances to find UP opportunities. HYPE was +7.1% on the day of adding. SOL/LINK are in the CLAUDE.md Canadian-allowed list.

**What to monitor / watch for:**
- More diverse regime mix in scan logs — not all 7 tickers should be DOWN simultaneously
- HYPE has high ATR (~8.6% daily range) — risk-based sizing will cap its position. Watch for `RISK-CAPPED` in logs
- If any new ticker consistently loses, can remove individually without disrupting others
- Rollback: remove the 4 tickers from the array

---

## 2026-05-14 — Risk-based position sizing cap — vps-claude

**Commits:** (see below)
**Files changed:** `v2/engine/config.ts`, `v2/pipeline/riskGate.ts`
**Stats baseline reset:** no

**What changed:**
Added `MAX_RISK_PER_TRADE_PERCENT: 0.01` (1% of equity) as a position size cap. After computing the base position size (equity × 0.25 × confidence × F&G), the risk gate now also computes `maxRiskUsd / stopDistPercent` and caps position size to whichever is smaller.

High-ATR assets like AKT (5% ATR → 10% stop distance) will now get ~$50-80 positions instead of ~$208. Low-ATR assets (DOGE/ADA with ~5% stop distance) will mostly be unaffected since their risk-cap is ~$100-160, close to what they already get.

Log messages for risk-capped trades show `RISK-CAPPED from $X (stop=Y%)` so we can see it working.

**Why:**
AKT post-mortem: 8 trades, 4 wins (+$12.47), 1 stop_loss (-$21.93). The stop_loss alone wiped all wins because AKT's 10% stop distance on a $208 position = $20+ max loss, vs ~$5-8 for lower-ATR pairs. Position sizing didn't account for stop distance — every asset got roughly the same dollar position regardless of volatility.

**What to monitor / watch for:**
- AKT/ZEC/high-ATR entries should show `RISK-CAPPED` in log and position sizes of ~$50-80 instead of ~$200
- Low-ATR pairs (DOGE, ADA) should be unaffected or only slightly capped
- If 1% is too conservative and positions are tiny, raise to 0.015 or 0.02
- Rollback: revert single commit

---
## 2026-05-12 17:15 UTC — Observability: persist exit-check decisions to decision_log — local-claude

**Files changed:**
- `v2/attribution/attributionStore.ts` (new `appendTradeDecision()` function)
- `v2/engine/tradeEngine.ts` (call it from `checkOpenExits()` on state change or heartbeat)

**Stats baseline reset:** NO (this is observability infrastructure, not a trading-config change)

### What it does
`checkExits` already emits a `DecisionRecord` on every exit-check loop (`result.decision`), but before today those records were discarded after the loop — `decision_log` in `v2_trades` only stored the entry decision. This change persists them when something interesting happens.

**Persistence triggers:**
1. **State change** (always persist): `currentStop` moved, `trailingActivated` flipped, or `shouldExit` set
2. **Heartbeat** (every 30 loops ≈ 30 min on 60s `BOT_LOOP_INTERVAL_MS`): periodic snapshot of "still holding, PnL X%, stop at Y"

**Bounded growth:** the log keeps at most 50 records — the entry decision (index 0) plus the last 49. Drops middle entries when full. For typical trade lengths (4-30h), this is way more than enough; for unusual >25h trades, early heartbeats roll off but the entry + last-near-exit detail is preserved.

**Per-trade dedup:** `checkOpenExits()` is called up to 3 times per main loop (after scan reject, after signal reject, end of loop). Without dedup, each heartbeat would persist 3 identical records. The `_lastDecisionPersistLoop` Map keys are trade IDs and skip duplicate same-loop heartbeats. State changes bypass dedup (they're rare and worth seeing).

### Why now
We just spent **5 days unaware** that exits were silently broken (krakenAdapter NaN bug — commit `70bcafa`). Throughout that period, `checkExits` was producing decisions like `"Holding: PnL NaN%, stop 507.70"` — that one log line would have made the bug obvious within hours of the first symptom. But because decisions weren't persisted, we couldn't see them.

This is also a force multiplier for the BE-stop fix validation: when AKTUSD #3 (or any future trade) hits BE-trigger territory, we'll be able to read back the exact sequence of state transitions instead of inferring from the final exit row.

### Cost
- One read + one write to `v2_trades.decision_log` per persisted decision
- ~1-3 persists per trade per 30 min (heartbeat) plus 0-N for state changes
- Bounded log size (50 records) keeps row size manageable
- Failures are caught + logged; never break exit logic (observability failures must not cause trading failures)

### Knock-on cleanup
- `_lastDecisionPersistLoop.delete(tradeId)` runs when `closeTrade()` is called — keeps the Map from growing unbounded over many trades.

### What to monitor
- **Next loop boundary (loopCount % 30 == 0)** for currently open AKTUSD #3 should produce a fresh heartbeat record in its `decision_log`
- **Next BE-trigger event** for any trade should append a state-change record exactly when `currentStop` is raised
- **`decision_log` column size** in v2_trades for long-held trades — should hover around log[0] + ~10-20 heartbeats for a 5-10h hold

### Rollback
Two-line revert in `tradeEngine.ts:checkOpenExits` (the new `if (isStateChange || heartbeatDue)` block). The new `appendTradeDecision` function in `attributionStore.ts` can stay (no callers = dead code, harmless).

---

## 2026-05-12 17:00 UTC — BE-stop offset +0.1% → +0.7% (covers fees+slippage) — local-claude

**Files changed:** `v2/pipeline/exitManager.ts` (one line in section 2b, plus comment)
**Stats baseline reset:** NO (tuning of exit protection, not entry strategy; expect existing cohort to remain comparable)

### What changed
Break-even stop offset raised from `entry * 1.001` (+0.1%) to `entry * 1.007` (+0.7%). The trigger remains at +0.8% pnlPercent — only the *stop level* moved.

### Why
The old comment said "+0.1% covers slippage" but the math didn't work:
- Kraken round-trip = 0.16% maker entry + 0.26% taker exit = **0.42% fees**
- Typical slippage on thin books like AKTUSD ≈ **0.2%**
- True net-zero break-even needs ≈ **+0.62% offset**

When the old BE stop fired, trades came out around -0.4% net — small but consistent loss. The diagnosis was triggered by AKTUSD trade #2 on 2026-05-12: 12-minute hold, BE triggered, BE hit, exit at -$1.88 with `exit_reason='trailing'` (because `currentStop > initialStop`, so the code routes BE hits through the trailing-exit label).

The new +0.7% offset leaves ~+0.1% net after fees+slippage when the BE stop fires. Turns the "lose small" outcome into "win small" without changing when BE engages.

### Why not also raise the trigger (Option B) or make it ATR-aware (Option C)
Raising the trigger from +0.8% to +1.5% would change WHEN we protect — and if a real reversal starts at +1.0% (under the new trigger), we'd ride it back to the −10% initial SL. Worse failure mode for marginal gain.

ATR-aware BE is architecturally cleaner (mirrors VPS Claude's quick-kill ATR scaling) but n=1 BE-hit data point is too thin to justify the complexity now. Defer until 10+ BE-hit trades show whether high-ATR tickers actually hit BE more than baseline.

### What to monitor
- **Next BE-stop hit:** should now exit positive (+0.1% to +0.3% net) rather than negative. Look for `exit_reason='trailing'` exits with small *positive* P&L.
- **The ride-through path doesn't change:** if a trade reaches +2.5% (trail activation), the trail's `currentStop > trade.currentStop` guard means stops only ratchet *up*. The +0.7% BE doesn't squeeze it.
- **Possible new failure mode:** between +0.8% (BE trigger) and +0.7% (BE stop), there's no overlap. So a trade that triggers BE at exactly +0.8% then drops to exactly +0.7% in the same loop exits at +0.7% gross = +0.28% net. Fine. But if loops are spaced more than ~1s apart and price whipsaws, we might miss the trigger entirely and never set BE — same as before this change.

### Rollback
Single line. Change `1.007` back to `1.001` in `v2/pipeline/exitManager.ts:section 2b`.

---

## 2026-05-11 13:30 UTC — 🚨 Critical fix: krakenAdapter.getLatestPrice returned undefined for new SCAN_TICKERS — local-claude

**Files changed:** `v2/exchange/krakenAdapter.ts` (one line)
**Stats baseline reset:** NO (urgent bug fix restoring intended behavior, not a strategy/config change)
**Manual intervention:** closed `b04cf666` (TREND/ZECUSD) via SQL at $553.27 bid before deploying — exit_reason=`manual_close`, pnl_net=-$3.75

### The bug (root cause of every "weird" thing observed since Config A)

`v2/exchange/krakenAdapter.ts:getLatestPrice` had:
```ts
return candles[candles.length - 1].close;
```
But `services/exchangeAdapters/krakenAdapter.js:getCandles` returns rows shaped `{t, o, h, l, c, v}` (abbreviated). The property `.close` doesn't exist — it's `.c`. So every call returned `undefined`.

The cryptocom V2 adapter had been correctly using `last.c ?? last.close ?? 0` (defensive). Kraken was missed.

### Why it stayed hidden for so long
The WS service hardcodes its subscription list to BTC/ETH/SOL/XRP/ADA/LINK/DOT/AVAX/DOGE/BNB. For trades on those tickers, `getLatestPrice` returned the WS cached price and never hit the broken REST fallback. So while TREND traded BTC/ETH/etc., everything looked fine.

**Config A (2026-05-06) switched SCAN_TICKERS to AKTUSD/ZECUSD/COMPUSD** — none of which are in the WS hardcoded list. From that moment forward, every TREND exit check fell into the broken REST fallback. `getLatestPrice` returned `undefined`, `pnlPercent = (undefined - entry) / entry` became `NaN`, and every exit condition silently failed (NaN comparisons always return false).

### What this explains
- **"0 closed trades since baseline"** in every progress report. Exits *literally could not fire*. Trades stayed open forever.
- **ZECUSD's 94.6h hold without trail activation**, despite 132 of the last 24h's 1m closes being above the trail trigger.
- **AKTUSD currently +6.1% with `trailing_activated=0`** — same bug, same silent NaN.
- **ENAUSD's `manual_close` on 2026-05-10** — VPS Claude/user noticed the trade wasn't exiting near TP and intervened manually. Same root cause; just manifested earlier.
- **VPS Claude's 2026-05-08 quick-kill/time-kill tuning (`0c4193f`)** could not actually have any effect on the running TREND engine — those conditions all branch on `pnlPercent`, which was NaN. The tuning becomes live with this fix.
- **The Sniper engines also have this bug dormant** — they use the same V2 Kraken adapter for sniper-Kraken's `getLatestPrice`. Sniper hasn't entered a trade yet so it's never bitten, but the fix applies universally.

### The fix
```ts
const last = candles[candles.length - 1];
return last.c ?? last.close ?? 0;
```

Defensive — accepts either shape. Matches cryptocom adapter pattern.

### Validation plan
After deploy:
1. AKTUSD (currently $0.8359, +6.1% from $0.7881 entry) — the very next exit-check loop should compute valid `pnlPercent ≈ 0.061`, activate the trail (>0.025 trigger), and lock in profit via giveback math.
2. Watch `trailing_activated` flip from 0 to 1 in the DB within ~60 seconds of deploy.
3. If AKT continues higher, trail will follow; if it pulls back, trail caps the giveback.

### Known follow-up work (deferred — separate commits)
- **TREND's `exitManager.ts` doesn't update `peak_price`** unlike every other strategy. This is a latent issue, but doesn't directly cause the trail bug (TREND's trail uses `currentPrice` not `peak_price`). Worth fixing for parity + future peak-based time-kill design.
- **`decision_log` is only persisted at entry**, never appended post-entry. If exit-check decisions had been persisted, this bug would have been caught the first time someone looked — every row would have shown `"Holding: PnL NaN%"`. Persisting decisions every N loops would close this observability gap.
- **WS service hardcoded subscription list** is decoupled from `V2_CONFIG.SCAN_TICKERS`. Should be derived from config (so changing scan tickers auto-subscribes). Until then, exit logic relies entirely on the REST fallback for non-default tickers.

---

## 2026-05-08 — Quick-kill ATR scaling + time_kill 12h→8h — vps-claude

**Commits:** (see below)
**Files changed:** `v2/engine/config.ts`, `v2/pipeline/exitManager.ts`
**Stats baseline reset:** no (want to see contrast vs prior trades in continuous stats)

**⚠️ Retroactive note (added 2026-05-11 by local-claude):** This change couldn't actually take effect in the running engine because of the krakenAdapter NaN bug fixed on 2026-05-11. The 28-trade dataset cited below came from pre-Config-A trades on BTC/ETH/etc. where WS gave valid prices. Once Config A switched SCAN_TICKERS, ALL exits became broken. The new 8h time_kill / scaled quick-kill becomes live alongside the 2026-05-11 fix.

**What changed:**
1. **Quick-kill ATR scaling** — the flat 1.2× ATR stop tightening at 4h was pulling stops into normal volatility noise on high-vol assets. The two worst trailing losses (-$4.85 ETH, -$3.51 ADA) both exited at exactly 4.0h hold. Now scales by ATR: >1.5% ATR → 0.6× mult, >1.0% ATR → 0.9× mult, else 1.2× (unchanged for low-vol). This gives ETH/ADA roughly 2× the breathing room at quick-kill time.
2. **TIME_KILL_MS 12h→8h** — time_kill trades were 8 trades, 25% WR, -$8.33 total. Hold duration data: >12h trades win 33%, <4h trades win 71%. Cutting stale positions at 8h instead of 12h reduces fee bleed on positions that aren't going to work.

**Why:**
28-trade post-baseline dataset showed time_kill and quick-kill-triggered trailing exits as the two biggest PnL drains. Quick-kill mechanical stops accounted for ~$8 of losses; time_kill for ~$8. Both are exit-side tuning, not entry changes.

**What to monitor / watch for:**
- Fewer 4.0h trailing losses on ETH/ADA — should hold longer through normal pullbacks
- Time_kill exits now happen at 8h instead of 12h — watch for any that would have recovered in the 8-12h window (check if time_kill avg PnL improves)
- If quick-kill stops are now too loose and positions bleed further before stopping, the 0.5 scaling factor may need to come up to 0.65
- Rollback: revert single commit

---
## 2026-05-07 12:38 UTC — Forced restart of `2f7df24` + push-deploy.sh + privilege diagnosis — local-claude

**Files changed:**
- `scripts/push-deploy.sh` (new — atomic dual-remote push + post-deploy verification)
- `CLAUDE.md` (Git Hygiene: ALWAYS push to BOTH; use push-deploy.sh)

**What happened:**
VPS Claude pushed `2f7df24` (re-disable MOMENTUM — entries bypass confidence gate) to `origin` only. The `vps` bare repo never got the commit, so the post-receive hook never fired, and PM2 kept running pre-`2f7df24` code that still had MOMENTUM enabled. The user noticed the bot was still opening MOMENTUM trades and asked for a restart.

Local Claude pulled `2f7df24` from origin, force-pushed to `vps`, which triggered the deploy hook. PM2 restarted at 12:38:42 UTC (PID 105546). Boot logs confirm `[V2] Momentum engine v2 disabled`.

**Diagnosis: not a permissions issue.** VPS Claude (user `claude`, UID 1001) actually has full deploy privileges:
- `NOPASSWD: /usr/bin/pm2` in sudoers
- `/opt/trading-bot.git/` is `drwxrwsr-x root:claude` (SETGID) — group-writable to claude
- `/opt/trading-bot/` is 777 — full claude r/w/x
- `sqlite3` works for stats queries / baseline writes

Root cause was workflow knowledge: VPS Claude pushed only to `origin` (GitHub backup), not to `vps` (the deploy trigger). CLAUDE.md said "push to vps when changes need to deploy" — too soft.

**Fix shipped:**
1. `scripts/push-deploy.sh` — pushes to BOTH remotes, waits for API to come back online, verifies deployed SHA matches pushed SHA. Auto-detects whether running on VPS or local and uses the right verification path.
2. CLAUDE.md Git Hygiene strengthened: "ALWAYS push to BOTH" + "use push-deploy.sh."

**For VPS Claude specifically:**
- Run `bash scripts/push-deploy.sh` after every commit instead of separate pushes
- The `vps` remote is `/opt/trading-bot.git` (local file path — no SSH needed from VPS)
- Script will fail loudly if the deployed SHA doesn't match — you'll know immediately if the deploy didn't take

**Stats baseline reset:** NO (no trading-config change beyond what `2f7df24` already shipped)

---

## 2026-05-07 ~12:00 UTC — Re-disable MOMENTUM engine (no confidence gate) — vps-claude

**Commits:** (see below)
**Files changed:** `v2/engine/config.ts`
**Stats baseline reset:** no

**What changed:**
MOMENTUM_CONFIG.ENABLED set back to false. Was flipped to true in Wave 4 (2026-05-06) but the momentum engine has its own entry path (momentumEngine.ts) that bypasses the signalGenerator confidence gate entirely — it entered ENAUSD at 0.601 confidence, well below the 0.70 threshold enforced on TREND. Prior live record was 0W/4L (-$2.80). This re-enable was premature — #30 (MOMENTUM redesign) is still deferred.

**Why:**
Discovered ENAUSD MOMENTUM position open at conf 0.601. Investigated and confirmed the momentum engine calls detectMomentumEntry() directly with no MIN_CONFIDENCE check. The confidence gate fix (commit 79eed18) only applies to the TREND signal pipeline.

**What to monitor / watch for:**
- Boot logs should show `[V2] Momentum engine disabled` again
- The open ENAUSD MOMENTUM position will run to completion on its existing stop/TP — no force close
- Rollback: set ENABLED back to true in config.ts (but fix the confidence gate first)

---

## 2026-05-06 ~later6 UTC — Dual-exchange SNIPER (Kraken + Crypto.com isolated) — local-claude

**Files changed:**
- `services/newCoinDetector.js` (state namespaced by exchange; functions take optional `exchange` param)
- `v2/engine/sniperEngine.ts` (rewritten as factory pattern; `createSniperEngine()` + `buildKrakenSniper()` + `buildCryptocomSniper()`)
- `v2/engine/config.ts` (`SNIPER_CONFIG`: added `KRAKEN_ENABLED`, `CRYPTOCOM_ENABLED`, `KRAKEN_BUDGET_USD`, `CRYPTOCOM_BUDGET_USD`)
- `v2/index.ts` (boot wiring for both engines)
- `v2/dashboard/attributionAPI.ts` (per-exchange status + scorecard endpoints)

**Stats baseline reset:** NO (sniper is isolated; day-trading untouched)

### What this is
The sniper engine now runs **two independent engines side-by-side** — one on Kraken, one on Crypto.com. Each has its own loop, candle cache, detector namespace, budget, and trade-strategy tag. Crypto.com's lower fees (0.15% round-trip vs Kraken's 0.52%) and broader memecoin listing roster give us a second venue to test.

### Reporting Contract Update — TWO sniper sections (or three counting day-trading)

**When asked for a progress report, output up to THREE separate sections:**

```
═══ DAY-TRADING (TREND + MOMENTUM, KRAKEN) ═══
[stats from v2_trades WHERE strategy IN ('TREND','MOMENTUM')
 AND entry_time >= stats_baseline_time]

═══ SNIPER — KRAKEN ═══
[stats from v2_trades WHERE strategy = 'SNIPER_KRAKEN']

═══ SNIPER — CRYPTO.COM ═══
[stats from v2_trades WHERE strategy = 'SNIPER_CRYPTOCOM']
```

**Never aggregate across these three sections.** They're three different strategies on potentially two different exchanges with different fees, liquidity, and listing rosters.

### Strict isolation guarantees

1. **Adapters:** day-trading uses `krakenV2` ONLY. Sniper-Kraken uses `krakenV2`. Sniper-Crypto.com uses `cryptoComV2` ONLY. No adapter is shared across day-trading and crypto.com.
2. **Budgets:** each engine calls `loadPortfolio(budget, strategyTag)` which filters v2_trades by tag. Day-trading's budget pool is calculated from `strategy IN ('TREND','MOMENTUM')` only; sniper-kraken from `SNIPER_KRAKEN`; sniper-cryptocom from `SNIPER_CRYPTOCOM`. Cannot cross-contaminate.
3. **Detector state:** `newCoinDetector.js` now keeps two parallel state Maps — `knownByExchange` and `listingsByExchange`. A new pair on Crypto.com cannot be flagged as new on Kraken.
4. **Tickers:** day-trading's `SCAN_TICKERS` (AKT/ZEC/COMP, plus 7-ticker MOMENTUM list) are static and never modified by sniper. Sniper picks dynamically from `getActiveNewListings(exchange)`.
5. **DB persistence:** `known_tickers` table stays Kraken-only (back-compat with V1 server.js callers). Crypto.com namespace is memory-only and warmup-acknowledged on every restart.

### Engine specs
- **Per-exchange budget:** $500 each (paper). Total sniper exposure: $1000.
- **Strategy tags:** `SNIPER_KRAKEN`, `SNIPER_CRYPTOCOM`. Old `SNIPER` tag still queryable via `/sniper/trades` (`tags includes 'SNIPER'`) for any pre-dual legacy trades.
- **Same entry rules** for both: listing age 30m-7d, RSI≤70, vol≥1.5×, 3-of-5 higher closes, rug-pull score < 2.
- **Fees:** Kraken sniper uses 0.42% round-trip (maker entry + taker exit); Crypto.com sniper uses 0.125% round-trip — same structure but ~3.5× cheaper.

### API endpoints
- `GET /api/v2/sniper/status` — both engines, isolated stats per exchange
- `GET /api/v2/sniper/kraken/status` — Kraken-only state
- `GET /api/v2/sniper/cryptocom/status` — Crypto.com-only state
- `GET /api/v2/sniper/scorecard` — three sections (kraken, cryptocom, legacy)
- `GET /api/v2/sniper/kraken/scorecard` — Kraken-only scorecard
- `GET /api/v2/sniper/cryptocom/scorecard` — Crypto.com-only scorecard
- `GET /api/v2/sniper/trades?exchange=kraken|cryptocom` — filter by exchange

### What to monitor
- **Both engines should boot:** look for `[SNIPER-KRAKEN] Sniper engine started` and `[SNIPER-CRYPTOCOM] Sniper engine started` on PM2 logs at startup.
- **Warmup-ack on first refresh:** each engine logs `Warmup: acknowledged N/total pair(s) on <exchange>`.
- **Detection rate:** Kraken adds ~1-3 USD pairs/week; Crypto.com varies. Watch for `[SNIPER-X] Pair refresh (exchange): N new` lines.
- **Per-exchange P&L:** the scorecard endpoint produces three sections so you can compare Kraken vs Crypto.com directly.

### Rollback
- Disable one exchange: set `SNIPER_CONFIG.KRAKEN_ENABLED = false` or `SNIPER_CONFIG.CRYPTOCOM_ENABLED = false`.
- Disable both: `SNIPER_CONFIG.ENABLED = false`.
- Existing open sniper positions are not auto-closed.

---

## 2026-05-06 ~later5 UTC — Hard-prune negative-edge signals (0.5× → 0×) — local-claude

**Files changed:** `v2/pipeline/signalGenerator.ts` (one-line `adaptWeight` change)
**Stats baseline reset:** YES — material entry-decision change

**What changed:**
The adaptive signal weighting system was already auto-down-weighting "negative" verdicts to 0.5× (soft prune). With 133 trades per signal — enough data — going to 0× (hard prune). Single-line edit in `adaptWeight()`.

**Why:**
Day-trading scorecard shows 4 signals with edge < -0.002 across 133 trades:
- `bb_percent_b` → bb_lower_touch eval: edge -0.0034, 28.6% WR
- `trend_strength` → trend_strength eval: edge -0.0035, 41.4% WR
- `atr_percent`: edge -0.0035 (tracked, not in composite — no change)
- `price_vs_ema50`: edge -0.0038 (tracked, not in composite — no change)

The first two were already at 0.5× weight via the adaptive system. Hard-pruning to 0× removes them from the composite entirely. Total composite weight drops from 175 to 110 (37% reduction in dead weight).

**Self-adapting:** if either signal later shows edge > 0.003 with WR > 0.55, it auto-revives at 1.5× ("proven" verdict). No code change needed.

**What to monitor:**
- **Entry frequency:** with 2 signals removed, fewer setups will hit MIN_COMPOSITE_SCORE=60. Expect a 10-20% drop in trade count over the next week.
- **WR + PF:** the pruned signals were correlated with losing trades. If pruning works as expected, WR rises (trade-quality up) even as count falls.
- **Daily report comparison:** first 24h post-baseline = small sample. Wait ≥10 trades before judging.
- **Risk:** if MIN_COMPOSITE_SCORE=60 becomes too hard to hit, threshold may need lowering to 55-58 to maintain useful entry rate.

**Rollback:**
Change `return 0` back to `return Math.round(baseWeight * 0.5)` in `signalGenerator.ts:adaptWeight`. Single line.

---

## 2026-05-06 ~later4 UTC — New-coin SNIPER engine shipped (isolated side-project) — local-claude

**Files changed:**
- `v2/engine/config.ts` (added `SNIPER_CONFIG` block)
- `v2/engine/sniperEngine.ts` (new — engine with own loop, budget, stats)
- `v2/pipeline/sniperSignal.ts` (new — entry detector, reuses `services/newCoinDetector.js`)
- `v2/pipeline/sniperExitManager.ts` (new — rug-pull-aware exits)
- `v2/index.ts` (boot wiring under `SNIPER_CONFIG.ENABLED`)
- `v2/dashboard/attributionAPI.ts` (added `/api/v2/sniper/{status,trades,scorecard}`)

**Stats baseline reset:** NO (sniper is isolated — TREND/MOM stats untouched)

### What this is
A side-project trading engine that snipes new Kraken USD listings during their early volatility window. Uses the existing `services/newCoinDetector.js` for listing detection + rug-pull screening; adds a v2-style entry/exit pipeline with its own independent budget ($500 paper).

### **REPORTING CONTRACT (read carefully — this is a standing rule)**

**Day-trading and sniper P&L are NEVER aggregated. EVER.** They are fundamentally different strategies and combining their stats hides the real performance of each.

**When the user asks for a progress report:** output TWO separate sections, one after the other. Never a combined "total PF" / "total PnL" / "total WR" line that mixes them.

```
═══ DAY-TRADING (TREND + MOMENTUM) ═══
[stats from v2_trades WHERE strategy IN ('TREND','MOMENTUM')
 AND entry_time >= stats_baseline_time]
- Total trades, WR, PF, PnL, max DD
- Exit reasons breakdown
- Recent trades

═══ NEW-COIN SNIPER ═══
[stats from v2_trades WHERE strategy = 'SNIPER']
- Total trades, WR, PF, PnL
- Active listings tracked + rug-pull scores
- Recent sniper trades
```

**SQL contract:**
- Day-trading: `WHERE strategy IN ('TREND','MOMENTUM') AND entry_time >= (SELECT value FROM settings WHERE key='stats_baseline_time')`
- Sniper: `WHERE strategy = 'SNIPER'` (no baseline filter — sniper has its own clean history starting now)

**API contract:**
- Day-trading scorecard: `GET /api/v2/scorecard` (existing — covers TREND + MOMENTUM)
- Sniper scorecard: `GET /api/v2/sniper/scorecard` (new — sniper-only stats)
- Sniper status: `GET /api/v2/sniper/status` (new — engine state, active listings)

**Telegram contract:**
- Day-trading alerts: `[V2]` prefix
- Sniper alerts: `[SNIPER]` prefix
- Both go to the same Telegram chat — visual prefix distinguishes them

### Why an isolated engine?
1. **Different fundamentals:** day-trading TREND/MOM target structured uptrends in known liquid coins; sniper hunts asymmetric volatility in unknown new listings. Mixing the win/loss profiles misleads tuning decisions.
2. **Cannot backtest:** sniper has no historical "new listing event" data to replay. Day-trading was tuned via 90d backtests; sniper has to be tuned from live trade outcomes.
3. **Different risk:** sniper has 6× higher rug-pull risk per trade. Tighter stops (-3%), shorter time-kill (8h), wider trail giveback (30%). Mixing this with day-trading's 12h holds and 2-2.5× ATR stops would muddle the post-trade analysis.
4. **Different success bar:** if sniper hits PF 1.2 with $50 trades, that's a win. Day-trading needs PF 1.6+ with larger size. Combined stats would mark sniper as "underperforming" when it's actually doing its job.

### Engine specs
- **Budget:** $500 (paper) — entirely separate from TREND ($3K) and MOMENTUM ($1K)
- **Detection:** polls Kraken AssetPairs every 30 min via `newCoinDetector.detectNewListings`
- **Listing window:** 30 min – 7 days post-listing (skip first 30 min of liquidity chaos)
- **Entry rules** (ALL must hit):
  - Rug-pull score < 2 (no major red flags)
  - Bar volume ≥ $500 USD
  - RSI ≤ 70 (not overbought)
  - Volume ratio ≥ 1.5× 12-bar avg
  - 3+ of last 5 closes higher than previous
- **Position size:** 10% of $500 × confidence (max 20%) = ~$25-100/trade
- **Max open:** 2 sniper positions simultaneously
- **Exits:** -3% hard stop / +5% trail activation / 30% giveback / 8h time-kill / rug-pull score ≥ 3 → instant exit

### What to monitor
- **Detection rate:** `getSniperStatus().newListingsDetected` should increment as Kraken adds new pairs (typically 1-3 per week)
- **Active listings tracked:** non-zero means detector is working; check the `listingsSample` array in /api/v2/sniper/status
- **First sniper trade:** could be days/weeks away — depends on Kraken listing cadence
- **Rug-pull triggers:** check `[SNIPER] Trade closed: ... reason=stop_loss` with peakPrice/exitPrice ratio for rug-pull exits
- **Per-trade size:** should be $25-100 — if much higher, position sizing has a bug

### Promotion path (if successful)
After ≥20 closed sniper trades with PF > 1.3 and positive net P&L:
1. Increase budget from $500 to $1000-2000
2. Consider live mode (not paper)
3. May raise MAX_OPEN_POSITIONS from 2 to 3-4
4. Even if promoted, **reporting stays isolated** — never merge into TREND/MOM stats

### Rollback
Set `SNIPER_CONFIG.ENABLED = false` in `v2/engine/config.ts`. Engine won't boot on next restart. Open sniper positions will not be auto-closed (rare; max 2 at any time) — manage manually if needed.

---

## 2026-05-06 ~later3 UTC — TimeGate overlay shipped: hour-of-day + day-of-week filter (Thread 3a/b) — local-claude

**Files changed:** `v2/pipeline/timeGate.ts` (new), `v2/pipeline/signalGenerator.ts`, `v2/pipeline/momentumSignal.ts`, `v2/backtest/multiStrategy/entryDetectors.ts`, `v2/backtest/backtestEngine.ts`
**Stats baseline reset:** YES — material filter change to entry decisions

**What changed:**
A new lightweight filter (`v2/pipeline/timeGate.ts`) that wraps both TREND and MOMENTUM signal generation. Blocks signals during the data-discovered worst hours/days, boosts during the best hours by lowering the score threshold.

**Pattern (data-discovered, validated on 132K training_trades + 137 v2 production):**
- **Hour 12 UTC (NY open):** 66.9% WR / +$783 avg in training, **85.7% WR / +$0.71 avg in v2 production** ← best
- **Hour 14, 17, 21 UTC:** consistently profitable — boosted
- **Hours 0, 4, 13, 20 UTC:** consistently worst (33-44% WR, -$1019 to -$2087/trade in training; -$0.85 to -$1.69 avg in v2) ← BLOCKED
- **Friday:** 40.5% WR, -$938/trade in training (catastrophic) ← BLOCKED
- **Sunday:** 58.8% WR, +$918/trade in training (best day)

**TimeGate config:**
- `BLOCKED_HOURS: [0, 4, 13, 20]` UTC — hard reject regardless of signal score
- `BLOCKED_DAYS: [5]` Friday — hard reject all-day
- `BOOSTED_HOURS: [12, 14, 17, 21]` UTC — lower entry-score threshold by 5 points
- `ENABLED: true` (default — overlay is active)

**Backtest result (Config A on AKT+ZEC+COMP, 4h, 90d — head-to-head):**

| Metric | TimeGate OFF | TimeGate ON | Δ |
|---|---|---|---|
| Trades | 150 | 126 | -16% |
| WR | 32.7% | 35.7% | +3.0 pp |
| **PF** | **1.53** | **1.93** | **+26%** |
| Net P&L | +$136 | +$179 | +$43 |
| Return | +4.5% | +6.0% | +1.5 pp |
| Max DD | -2.3% | -1.4% | 40% reduction |

**Robustness across windows (TimeGate ON):**
- 30d: PF 1.74 / +1.3%
- 60d: PF 1.62 / +3.3%
- 90d: PF 1.93 / +6.0%

**Why this works:**
The blocked hours (0, 4, 13, 20 UTC) were where stops were getting hit disproportionately — likely thin-liquidity windows (Asian open lull, Asian-EU handoff, NY close exhaustion). The boosted hours (12, 14, 17, 21 UTC) align with NY market session activity when trends actually develop and follow through.

**Where applied:**
- Live engine TREND path: `signalGenerator.ts:generateSignals` after composite-score calc
- Live engine MOMENTUM path: `momentumSignal.ts:detectMomentumEntry` early gate
- Single-strategy backtest: `backtestEngine.ts` after composite-score check
- Multi-strategy backtest: `entryDetectors.ts` global gate (covers all strategies)

**For backtests** the gate uses the candle's `last bar time`. **For live** it falls back to `Date.now()`.

**What to monitor:**
- `[V2] REJECT: TimeGate blocked hour X UTC` log lines should appear ~16% of the time during scans
- Friday rejects: full-day silence on TREND/MOMENTUM entries (existing positions still managed by exits)
- Hour 12, 14, 17, 21 UTC: signals scoring 55-59 should now pass (boosted threshold) — watch for `[V2] PASS: ... TimeGate=boosted hour ...`
- Combined with TREND + MOMENTUM v2: aggregate PF target raises to ~1.7-2.0
- If first week shows zero trades, pattern may not match recent regime — disable via `TIME_GATE_CONFIG.ENABLED = false`

**Rollback:**
Set `TIME_GATE_CONFIG.ENABLED = false` in `v2/pipeline/timeGate.ts`. Single line, no other changes needed.

---

## 2026-05-06 ~later2 UTC — MOMENTUM v2 ENABLED live (running alongside TREND) — local-claude

**Files changed:** `v2/engine/config.ts` (MOMENTUM_CONFIG.ENABLED: false → true)
**Stats baseline reset:** YES — new baseline set on VPS post-deploy

**What changed:**
Single-line flip activating the ported MOMENTUM v2 engine. Now both TREND (Config A on AKT+ZEC+COMP) and MOMENTUM v2 (on ZEC, RUNE, FLOW, ENA, KAS, ICP, WIF) run concurrently in paper mode.

**Why now:**
Code was validated in backtest (PF 1.70 / 90d, 2.32 / 30d) and ported to the live engine path in commit `80c409b`. Multi-strategy backtest after port confirmed PF 1.41 holds with the latest data. No reason to keep dormant — let it accumulate live trades for evaluation.

**Expected behavior:**
- 7-ticker scan on 4h candles, ~1 entry per day
- Average position duration: 2-4 days
- Max concurrent positions: 2 (separate budget pool from TREND)
- ZECUSD overlap with TREND is intentional — different signal patterns, position-cap protection prevents double-stacking

**What to monitor:**
- `[MOM] Trade opened/closed` log lines should appear within ~24h
- Aggregate (TREND + MOMENTUM) trade count: ~3-5/day
- If MOMENTUM produces 0 trades after 48h: lower `HISTOGRAM_SPIKE_Z` threshold from 1.0 to 0.7 in `MOMENTUM_CONFIG`
- If MOMENTUM produces too many losers (>70% loss rate over first 20 trades): increase z-threshold to 1.3 OR reduce `SCAN_TICKERS` to top-3 (ZEC, RUNE, FLOW which had highest individual P&L in backtest)
- Combined PF target: 1.4-1.6 across both strategies

**Rollback:**
Revert this single-line commit — sets ENABLED back to false. No state corruption risk.

---

## 2026-05-06 ~later UTC — MOMENTUM v2 ported to live engine (default disabled) — local-claude

**Files changed:** `v2/pipeline/momentumSignal.ts` (rebuilt), `v2/pipeline/momentumExitManager.ts` (rebuilt), `v2/engine/momentumEngine.ts` (rebuilt), `v2/engine/config.ts` (added MOMENTUM_CONFIG block), `v2/index.ts` (re-enabled MOMENTUM gated on MOMENTUM_CONFIG.ENABLED), `v2/backtest/multiStrategy/entryDetectors.ts` (v2 entry logic — already in use for backtests)
**Stats baseline reset:** no — MOMENTUM_CONFIG.ENABLED=false by default; this is dormant code, no live behavior change until flag flips

**What changed:**
Port of the MOMENTUM v2 rebuild (validated in backtest at PF 1.70-2.32 across windows) from the multi-strategy backtest path to the live engine code path. New code lands disabled by default — flip `MOMENTUM_CONFIG.ENABLED` to `true` when ready to ship live.

**Why MOMENTUM v1 was broken:**
Original entry compared `|macdHist|` (price-acceleration units) to `avgAbsMove` of price changes (price units). Different scales → near-random output → 0% WR over 7 trades historically. Original exit used `histogram_decay` which fired at first momentum stall — too sensitive, exited at losses.

**v2 entry logic:**
- z-score spike: `(macdHist - mean20) / stdev20 ≥ 1.0` — proper statistical "is this unusual"
- Higher-highs filter: 3+ of last 5 closes higher than previous bar
- Current bar's high > prior 3 bars' highs (real breakout, not single-bar wick)
- RSI bracket 50-70 (momentum but not overbought)
- Volume ≥ 1.3× 20-bar avg
- Stop: 3-bar swing low - 0.2 ATR (not arbitrary ATR-multiple)

**v2 exit logic:**
- Take-profit: 3× ATR (added — original had no TP, relied entirely on histogram_decay)
- Break-even at +1.5% PnL
- Trailing stop: activates at +2.5%, gives back only 5% of peak gain (replaces histogram_decay)
- Quick-kill: tighten stop after 4 bars with no progress
- Time-kill: 16 bars (16 × 4h = 2.7d)

**Backtest reference (multi-strategy backtest, identical entry logic to live):**
- 7 tickers: ZECUSD, RUNEUSD, FLOWUSD, ENAUSD, KASUSD, ICPUSD, WIFUSD
- Timeframe: 4h
- 30d: PF 2.32 / +0.9% / max DD 0.2%
- 60d: PF 2.15 / +1.2% / max DD 0.2%
- 90d: PF 1.70 / +1.0% / max DD 0.4%
- Latest validation (post-port): PF 1.41 / +0.6% / max DD 0.6% (window slid forward; still profitable)
- Avg win/loss ratio: 4.04-4.66× across runs

**Why ZECUSD overlaps with TREND's SCAN_TICKERS:**
Different signal patterns extract different edges from the same asset. TREND fires on composite-score breakouts; MOMENTUM fires on z-score histogram spikes after pullbacks. They rarely fire simultaneously. Position-cap protection prevents double-stacking.

**To ship MOMENTUM v2 live (next session):**
1. Flip `MOMENTUM_CONFIG.ENABLED` to `true` in `v2/engine/config.ts`
2. Push commit + deploy via VPS hook
3. Set new `stats_baseline_time` (per CLAUDE.md — material strategy enable counts as a config change)
4. Monitor for 50+ MOMENTUM closes before evaluating — initial sample is noisy

**What to monitor when enabled:**
- `[MOM] Trade opened: ...` log lines — should fire ~1×/day across 7 tickers
- `[MOM] Trade closed: ... reason=trailing PnL=$+X` — most exits should be `trailing` or `take_profit`
- `[MOM] Trade closed: ... reason=stop_loss` should be ~30% of exits (the strategy's WR ~30%)
- `[MOM ExitMgr] skipped X` warnings should be rare
- If z-score threshold (1.0) produces zero trades for >48h, lower to 0.7 in MOMENTUM_CONFIG

**Rollback:**
`MOMENTUM_CONFIG.ENABLED = false` (or revert this commit). Live engine path matches the multi-strategy backtest path now — same logic in two places. Future changes to one should mirror to the other.

**`v2/backtest/multiStrategy/entryDetectors.ts`** (the v2 detect functions for MR/BO/MOM): committed alongside this change. The MR and BREAKOUT v2 rebuilds are present but their live engines are NOT being re-enabled (PF 0.18 and 0.37 respectively in clean tests — not viable). Code is preserved for future rework reference.

---

## 2026-05-06 ~UTC — Config A deploy: TREND optimization shipped to live (paper) — local-claude

**Files changed:** `v2/engine/config.ts`, `v2/pipeline/signalGenerator.ts`
**Stats baseline reset:** YES — new baseline = epoch ms set on VPS post-deploy (see deploy log)

**What changed:**
Final result of an 80+ experiment optimization sweep across 14+ rounds. Three changes shipped:

1. **`SCAN_TICKERS`** (5 → 3): `ETHUSD, XRPUSD, DOGEUSD, DOTUSD, ADAUSD` → **`AKTUSD, ZECUSD, COMPUSD`**.
   Wide-ticker scan tested 50+ candidates. AKT (Akash compute), ZEC (Zcash privacy), COMP (Compound DeFi)
   showed strongest individual edges (PF 1.69, 1.33, 1.20 respectively). Old ticker set's PF was 0.40.
2. **Exit params (Config A):**
   - `STOP_LOSS_ATR_MULT`: 2.5 → **2.0** (tighter stop, smaller avg_loss)
   - `TRAILING_ACTIVATE_PERCENT`: 0.01 → **0.025** (wait longer before trail activates — reduces premature exits)
   - `TRAILING_GIVEBACK_PERCENT`: 0.25 → **0.03** (extreme tight trail — keeps 97% of peak gain when triggered)
3. **Signal weights** in `signalGenerator.ts`:
   - `bb_lower_touch`: 10 → **40** (this signal was ✓ PROVEN at 66.7% WR / +2.50% edge across all backtest runs)
   - `macd_cross`: 20 → **40** (✓ PROVEN at 62.5% WR / +0.72% edge in stacked configs)

**Why:**
Single-strategy backtest (live engine code path), AKT+ZEC+COMP, 4h, 90d:
  - **Before (default config, 5 generic tickers):** PF 0.40, -7.0% return, max DD 7.8%
  - **After (Config A):** PF 1.62, +5.0% return, max DD 2.3%
  - Improvement: +1.22 PF (4× ratio), +12.0pp return, max DD halved

Key driver: avg_win went from $1.92 to $8.03 (winners now run further before trail tightens).
Trade count fell 319 → 143 (selectivity up; fewer trades, each higher quality).

**Why these tickers:**
  - AKTUSD: PF 1.69 standalone, 76 trades, +9.0% — best individual ticker
  - ZECUSD: PF 1.33, 59 trades — solid, low correlation to AKT
  - COMPUSD: PF 1.20, 44 trades — third-best, DeFi exposure for diversification
  - All other tested tickers (ETH, BTC, JTO, ICP, RENDER, etc.) had PF < 1 in current 90d regime
    OR drag down PF when added to ensemble

**Robustness verified:** 30d PF 1.00 (yellow flag — recent month is break-even before slippage),
60d PF 1.33, 90d PF 1.62. All windows non-negative. Strategy improves with longer windows.

**What to monitor / watch for:**
- **Trade frequency** — expect ~1.6 trades/day across 3 tickers. If 0 trades for 48h+, signal gate may be too tight; lower `MIN_CONFIDENCE` to 0.65 in config.
- **`SCAN_TICKERS` change took effect** — first boot log should show `[V2] Engine initialized: ... exchange=kraken` and signal scans on AKTUSD/ZECUSD/COMPUSD only. Old ticker mentions in logs are from pre-restart trades aging out.
- **Live performance vs backtest** — backtest doesn't model slippage beyond 0.52% round-trip, partial fills, ML gatekeeper rejections. Expect live PF 0.5-1.0 lower than backtest's 1.62.
- **30d PF watch** — if live trades over the next 30 days show PF < 1.0, that confirms the yellow-flag concern and we should reconsider. If PF > 1.3, the optimization is real.
- **Open positions from before deploy keep running** on old config — don't force-close. Track outcomes as legacy/background, primary stats use new baseline.
- **V2_MODE remains `shadow`** (paper) — no real money at risk. Decision to flip to `live` is separate.

**Rollback:**
Single revert of this commit reverts all three changes. The pre-Config-A defaults are well documented in the comments.

**Next session — MOMENTUM v2 port to live:**
A rebuilt MOMENTUM strategy (real z-score spike detection + higher-highs filter + percent-giveback trail)
showed PF 1.70-2.32 across all backtest windows on `ZECUSD, RUNEUSD, FLOWUSD, ENAUSD, KASUSD, ICPUSD, WIFUSD`.
Currently lives in `v2/backtest/multiStrategy/entryDetectors.ts` (backtest-only). Next session will port to
the live engine path (`v2/engine/momentumEngine.ts`, `v2/pipeline/momentumSignal.ts`) and re-enable in
`v2/index.ts`. Combined deployment expected: TREND (PF 1.62) + MOMENTUM (PF 1.70+) on disjoint ticker sets.

---

## 2026-05-04 03:30 UTC — Wave-4 sweep: 8 batches covering MEDIUM + LOW items — local-claude

**Commits:** `40102e6`, `69f7d40`, `795d3e6`, `6074a10`, `ca12e5e`, `28b9d30`, `e2ee559`, `b7e9903`
**Files changed:** 18 files across core/, services/, v2/, routes/, server.js — see individual commits
**Stats baseline reset:** no (hardening / cleanups, no trade-config changes)

**What changed:**
8 batches of polish/hardening work. Skipped purely cosmetic items (stale "62-element" docstrings, worker-timeout doc/code drift) per the rule: doesn't change behavior + doesn't reduce surprise + doesn't catch a future bug ⇒ skip. M13 + M19 were already done in earlier waves.

**Batch A (`40102e6`) — core/ cleanup (M1, M3, M4, M5, M6):**
- M1: deleted `core/incrementalIndicators.ts` (dead code; "10-50× faster" never wired). Removed import + ctx re-export.
- M3: stakingEngine.accrueRewards now tracks `lastAccrueAt` per position and bills the actual elapsed delta (capped at 24h). Old code under-counted reward whenever an interval was missed or restart occurred.
- M4: stakingEngine docstring updated — used to claim auto-unstake but no caller invokes unstake() from the buy path. Now documents stakes-are-one-way.
- M5: healthMonitor risk:alert was emitting `severity: 'medium'` (not in the union); now `'warning'`.
- M6: shortSellingEngine entry events now tagged `direction: 'short'` (added optional field on EntryEvent). Telegram renders "SHORT" vs "BUY" label.

**Batch B (`69f7d40`) — silent-failure cleanup (M2, M7, M8):**
- M2: dbBatcher.flush — rate-limited warn when no executor is wired + buffered writes present, hard-cap buffer at 4× maxBufferSize with oldest-dropped to prevent OOM if init fails.
- M7: Telegram send() detects non-2xx responses, parses retry_after, rate-limited warn (1/60s) so 429s and network failures aren't invisible. Same for poll-error path.
- M8: Telegram pollCommands errors now surface via the same rate-limited warn.

**Batch C (`795d3e6`) — database hygiene (M9, M10, M11):**
- M9: schema_version table documented in-place as non-authoritative (kept for any analyst tools, but commented).
- M10: cleanupOldData extended to ml_gatekeeper_log, shap_history, agent_performance, drift_events, system_logs (all grow ~17K rows/day). Refactored into a `sweep()` helper so a missing table doesn't block the others.
- M11: composite index on `v2_trades(status, entry_time)` — every CHANGELOG monitoring query and the stats-baseline filter use this predicate; was full-table scan.

**Batch D (`6074a10`) — ML hardening (M14, M15, M16):**
- M14: syntheticDataEngine TimeGAN supervisor training disposes the inline `tf.zeros(...)` tensor that was leaked per epoch.
- M15: OnlineLearner.serialize returns a plain object (not a JSON string), preempting the same double-encoding bug class that 7e80042 fixed in mlPredictionService.
- M16: mlEngine.scaler.transformRow hard-guards against an empty scaler (the lingering hazard from pre-7e80042 saves) — returns the raw row + rate-limited warn instead of silently returning [].

**Batch E (`ca12e5e`) — execution + adapters (M17, M18; M20 deferred):**
- M17: executeLimitThenMarketSell dust-check fallback uses midPrice instead of $1 (BTC at qty=0.0001 used to fail the check and never market-sell, leaving position un-exited).
- M18: cryptocomAdapter per-pair minimum notional (BTC=$10, ETH=$5, default $1). Was hardcoded $1, BTC orders ≥$5 fell through to a less helpful exchange error.
- M20: WS reconnect candle backfill — deferred (substantive feature, risk bounded by H14 stale-detector + rare disconnects).

**Batch F (`28b9d30`) — v2 bearishServices + executor (M21, M22, M23):**
- M21: DCA cooldown seeds from v2_dca_buys on first call (was in-memory only — PM2 restart bypassed cooldown).
- M22: bearishServices persist functions log via shared rate-limited warn helper instead of swallowing.
- M23: executor sets `strategy: 'TREND'` explicitly on V2Trade instead of relying on attributionStore's `?? 'TREND'` default.

**Batch G (`e2ee559`) — server hardening (M24, M25, partial M27, LOW notes):**
- M24: CORS regex now restricts numeric-IP origins to RFC1918 private ranges only.
- M25: bot-loop watchdog also unlocks the mutex when it fires + counter for visibility (real abort still needs AbortController per call — separate refactor).
- LOW: `express.static` uses `dotfiles:'deny'`.
- LOW: generic 500 error handler no longer leaks raw err.message + stack to remote clients (localhost still gets full details).
- LOW: `/api/system-config POST` now admin-gated (was missed in C4 — high blast radius via {killAll:true}).
- LOW: `/feeds/live` reduced to a clean stub (dataIngestion service was removed).
- M27: deferred to a separate refactor pass — the highest-value silent catches were already addressed in Wave 1 H17, Wave 2 H4/H5, batch B, batch F. Remaining ~25 empty catches are mostly benign per-loop optional-resource cleanup.

**Batch H (`b7e9903`) — routes (M12):**
- M12: routes/persistence.js GET /candles validates start/end as finite numbers via Number()+isFinite, rejects malformed timestamps with 400. parseInt('2024-01-01') used to silently return 2024 (= 1970ms) → empty result.

**What to monitor / watch for:**
- **Boot logs**: should see one extra index-creation message for `idx_v2_trades_status_entry_time` (idempotent — silent on subsequent boots). No errors during the safeAlter for stop_order_id from C2.
- **Telegram alert health**: any Telegram failures previously invisible. New rate-limited warn pattern: `[TelegramV2] Send returned 429 (N fails since last log)…`. If you start seeing these, you may need to lengthen the dedup window or look at whether the bot is sending too frequently.
- **Watchdog reset counter**: `[WATCHDOG] Bot loop stuck for Xs — force-reset #N` — `#N` should stay at 0 or grow very slowly. If it climbs, the underlying slow-async-call needs a timeout wrapper.
- **DB size after next cleanup run** (1×/day per memory): `ml_gatekeeper_log`, `shap_history`, `agent_performance`, `drift_events`, `system_logs` should now show drops in the cleanup result log line.
- **Crypto.com BTC orders <$10**: now rejected client-side with a clearer error; previously fell through to the exchange's less helpful response.
- **Short trades in Telegram**: now display "🔵 KRAKEN SHORT" instead of "🔵 KRAKEN BUY". Existing short positions opened before this deploy still show as BUY in their original alert (the alert isn't replayed).
- **/api/system-config**: any external monitoring that pokes this endpoint will get 503 until ADMIN_API_KEY is set (same as the other C4-gated routes). Localhost works.

**Total fix count across all 4 waves: 49 fixes** — 6 CRITICAL + 16 HIGH (Waves 1-3) + 27 MEDIUM/LOW addressed or deferred-with-rationale (Wave 4). All deployed.

---

## 2026-05-04 02:00 UTC — Wave-3 audit-driven sweep: 7 fixes (1 CRITICAL + 6 HIGH) — local-claude

**Commits:** `01b1652`, `ffc7b3c`, `3ca7010`, `86d2a66`, `d96f829`, `f54dc3a`, `26ba84b`
**Files changed:** `services/database.js`, `services/mlPredictionService.js`, `services/mlGatekeeper.js`, `core/TradingEngine.ts` (deleted), `core/portfolioManager.ts`, `core/arbitrageEngine.ts`, `v2/pipeline/types.ts`, `v2/attribution/attributionStore.ts`, `v2/engine/tradeEngine.ts`, `v2/pipeline/executor.ts`, `v2/pipeline/exitManager.ts`, `v2/engine/dualExchangeEngine.ts`, `middleware/adminAuth.js` (new), `server.js`, `routes/engines.js`, `routes/auth.js`, `routes/intelligence.js`, `routes/persistence.js`
**Stats baseline reset:** no (bug fixes / hardening — keep continuous stats)

**What changed:**
The 7 audit items that were blocked on user decisions in Waves 1-2. User authorized "best judgment" on each; decisions documented in commit messages.

1. **`01b1652` H2 — `regime` wired into ml_features inserts.** Schema column was added but never written by insertMLFeatures/insertMLFeaturesBatch (NULL on every live-loop sample). Investigation: regime is also encoded in features_json index 9, but transfer-samples.mjs writes to the column, and ad-hoc SQL filtering by regime is genuinely useful. Fix: extend both insert helpers to accept regime (default null for back-compat); mlPredictionService now passes marketRegime through.
2. **`ffc7b3c` H9 cleanup** — replace TradingEngine type-only import in portfolioManager with inline EngineLike interface (companion to the deletion that landed in 01b1652).
3. **`3ca7010` H10 — arbitrageEngine disabled.** start() is a no-op. Three high-sev issues (synthetic bid/ask, no leg-failure rollback, setCommonTickers never called → idle anyway). Re-enable checklist documented at file head. Code preserved as reference for eventual rewrite.
4. **`86d2a66` H1 — ML feature count aligned at 88.** Training previously padded to 109; gatekeeper truncated to 88 before predicting → tree split nodes with featureIndex >= 88 read undefined → silent prediction skew. Now both train and predict use RELIABLE_FEATURE_COUNT (88) — honors original B2 design (avoid imputed external-API features). Existing 109-trained models in DB remain mismatched until next retrain (~30 min); after one retrain cycle, alignment is permanent.
5. **`d96f829` C2 — V2 native SL bookkeeping.** Added stop_order_id column + idempotent migration. V2Trade gains optional stopOrderId. Executor captures from placeStopLoss return; tradeEngine cancels the SL order before placeMarketSell on managed exits — prevents stale SL from firing on next re-entry's price dip and accidentally closing the fresh position.
6. **`f54dc3a` H3 — dual-engine paper exits actually run BE/trailing/quick-kill.** checkExits previously called updateTradeStop/markTrailingActivated which threw "Trade not found" for in-memory paper trades, aborting the entire exit-check loop. Refactor: checkExits accepts an optional ExitMutators interface (default = DB-backed, zero behavior change for production); dual engine passes in-memory mutators that mutate the trade object directly.
7. **`26ba84b` C4 — shared-API-key auth on sensitive endpoints.** New middleware/adminAuth.js: localhost exempt, otherwise X-API-Key header must match `ADMIN_API_KEY` env (default-deny if env unset → 503). Applied to: POST /api/engines/:exchange/{start,stop,pause,resume,mode}, POST /api/training/*, GET /api/auth/{ws-auth,debug-balance}, POST /api/ai/analyze, PUT /api/db/settings/:key.

**Why:**
Closes the audit's "gray-area" items where a design decision was needed before fixing. User explicitly delegated each call ("whatever you think is best", "yes", "fix it", etc). For C4, chose targeted endpoint gating (vs whole-server localhost-only) so the dashboard still works remotely once the user sets `ADMIN_API_KEY`.

**Operational note (C4):**
Until you set `ADMIN_API_KEY` in the VPS environment, all the gated endpoints will return `503 {error: "Admin endpoint disabled..."}` from non-localhost clients. To enable:
  1. SSH to VPS, edit /opt/trading-bot/.env, add `ADMIN_API_KEY=<your-secret>`.
  2. `pm2 restart canuck-node --update-env`.
  3. From any remote dashboard / curl client, send `X-API-Key: <your-secret>` header on the gated routes.
Localhost callers (same-machine UI, server-side internal calls) keep working with no header — no behavior change.

**What to monitor / watch for:**
- **`stop_order_id` column** populates after the next live trade entry. Verify: `SELECT id, ticker, stop_order_id FROM v2_trades WHERE entry_time > <baseline> AND status='open'` — should be non-null for live-mode trades, null for SIM/paper.
- **Stale-stop incidents**: previously, after a managed exit + re-entry on the same ticker within seconds, the old native SL could fire on the fresh position. Should stop happening. Search PM2 logs for `cancelOrder(SL ` to confirm cancels are firing during exits.
- **Dual-engine BE/trailing/quick-kill rates**: previously zero (silently aborted). Should now show non-zero counts in dual-engine close stats. Compare `engine.stats.exitsByReason` if exposed; or query closed dual trades' exitReason distribution.
- **ML model retrain**: within 30 min of deploy, the next retrain will produce an 88-feature model. Verify scaler.means.length=88 in the next saved model. Until then, the existing 109-trained models in DB still mismatch the gatekeeper's 88-feature input — but that's the same state we had before the fix.
- **Crypto.com auth log noise**: arbitrageEngine.start() being a no-op means no more "[ArbitrageEngine] Started — scanning every 2000ms" log on boot. Boot log will show "[ArbitrageEngine] DISABLED" instead.
- **Auth 401/503 spikes** in logs after deploy: if any client (frontend, internal script, monitoring) was calling the gated endpoints from a non-localhost address without a key, it'll start getting 503. Set ADMIN_API_KEY and pass it as `X-API-Key` to fix.

**What's next:**
- **Wave 4**: 27 MEDIUM + LOW items, queued. Many are silent-failure/cleanup patterns from the audit. Lower urgency than Waves 1-3.

---

## 2026-05-03 23:55 UTC — Wave-2 audit-driven sweep: 8 fixes (CRITICAL+HIGH) — local-claude

**Commits:** `29f2e26`, `3669c68`, `ecc355c`, `8c58d3d`, `66d8953`, `45475b4`
**Files changed:** `services/exchangeAdapters/cryptocomAdapter.js`, `server.js`, `v2/engine/tradeEngine.ts`, `v2/pipeline/exitManager.ts`, `v2/engine/config.ts`, `v2/engine/dualExchangeEngine.ts`, `v2/pipeline/executor.ts`, `v2/pipeline/riskGate.ts`, `services/featureEngineering.js`, `services/websocketService.js`
**Stats baseline reset:** no (bug fixes restoring intended behavior — keep continuous stats so the impact is measurable)

**What changed:**
Wave 2 of the audit-driven fix series. 6 logical commits covering 8 audit items:

1. **`29f2e26` C1 — Crypto.com cancelOrder signature unified.** `cryptocomAdapter.cancelOrder` previously required `(orderId, ticker, sessionId)` but executionEngine and most server.js call sites use Kraken's `(orderId, sessionId)` form. Crypto.com received `sessionId` as `ticker`, called `formatTicker(sessionId)`, sent garbage `instrument_name`, and the cancel silently failed inside the executor's try/catch. In limit-then-market, the unfilled limit then stayed live while the fallback market order also fired → **double fill**. Fix: detect signature via `arguments.length`; when ticker is missing, look up `instrument_name` via `private/get-order-detail`. Backward-compat preserved for 3-arg callers.
2. **`3669c68` C3 — Dead Man's Switch wired up.** `krakenAdapter.cancelAllOrdersAfter` was implemented but never called anywhere. Memory described a 60s/90s heartbeat as active — it wasn't. If the bot crashed with native SLs open, those SLs stayed live indefinitely. Now: on startup (Kraken active + REAL mode + creds reachable), arm the switch immediately and keep warm via 60s heartbeat with 90s server-side timeout. Re-attempt timer fires every minute so late authentication still arms the protection (no-op when running). Failed heartbeats rate-limited to 5%.
3. **`ecc355c` H4+H5 — V2 engine robustness.** (a) `insertTrade` is now wrapped in try/catch; on failure in live mode, attempt market-sell rollback (with CRITICAL log if rollback also fails) — previously a DB write failure left a position on the exchange with no in-process record (BE-stop, trailing, TP, time_kill all skipped). (b) Each trade iteration in `exitManager.checkExits` is wrapped in try/catch — previously one bad price fetch unwound the for-loop and skipped exit checks for every remaining trade for up to BOT_LOOP_INTERVAL_MS (60s).
4. **`8c58d3d` H6+H7 — V2 fee accounting overhaul.** Added `EXCHANGE_FEES.*.ROUND_TRIP_REAL` (maker entry + taker exit) and `getExchangeFees(name)` helper to `v2/engine/config.ts`. Threaded through:
   - `tradeEngine.ts` exit fee → exchange-aware TAKER (Kraken 0.26%, Crypto.com 0.075%); old code over-stated fees by ~3.5× when running on Crypto.com.
   - `executor.ts` paper + live entry fee → exchange-aware MAKER.
   - `riskGate.ts` expected-return gate → uses ROUND_TRIP_REAL (0.42% on Kraken) instead of pure-maker assumption (0.32%); the 0.10% under-estimate was letting marginal-edge trades through the filter.
   - `dualExchangeEngine.ts` exit fee → always TAKER regardless of exit reason (mirrors `fa3e878` which fixed this in main tradeEngine.ts but missed dual). Also: stopped deducting `entryFee` from `engine.budget` at entry — it was already counted in pnlNet on close, so equity was double-deducting entry fees.
5. **`66d8953` H13 — NaN/Inf sanitize in feature vector.** Division-by-zero in upstream indicators (RSI when avgLoss=0, ATR with 0 range) produced NaN/Inf that passed through `imputeMissingFeatures` (which only branches on `=== 0`). Without this, `mlEngine.scaler.transformRow` clamped NaN → 0 silently, but `tfEngine.predictLSTM` passed NaN into `tf.tensor3d` → NaN throughout the network → confidence NaN → fell through gatekeeper's NaN-failopen invisibly. Final-pass `Number.isFinite` check now zeroes any non-finite value.
6. **`45475b4` H14 — Crypto.com WS stale-connection detector.** sendHeartbeat fired every 10s but nothing checked for response timeout; TCP zombies kept `connected=true` while no candles flowed. Mirrors `KrakenWS.checkHeartbeat` (services/krakenWebsocketService.js:152): track `lastMessageTime`, every 5s check elapsed; >30s warns, >40s force close + reconnect.

**Why:**
Wave 2 of the audit-driven sweep. These were the 8 larger CRITICAL/HIGH items that didn't need design decisions. Patterns from prior fix rounds (`fa3e878` exit fee, `6c9127e` SL rollback, schema-drift class) were used as templates and several more sites were found and fixed.

**What to monitor / watch for:**
- **Crypto.com double-fill rate**: previously hidden in try/catch on cancel. Watch `[ExecutionEngine] Limit ... failed` warnings — should drop. If a position size on Crypto.com is suddenly larger than expected after a fill, the underlying cancel pattern needs another look.
- **Kraken Dead Man's Switch logs**: should see `[Server] Dead Man's Switch armed: 60s heartbeat / 90s timeout` once on startup (and possibly again later if creds came in via UI). If the bot crashes, Kraken should auto-cancel all open orders within 90s.
- **V2 P&L numbers on Crypto.com**: previously over-stated fees by ~3.5×. Recorded `pnl_net` on Crypto.com trades after this deploy will be slightly higher than pre-deploy comparable trades. The change is correctness, not performance — trade selection should be unaffected.
- **riskGate rejections**: now slightly stricter (0.42% required vs 0.32%). A few marginal trades that previously passed may now show `[V2] RISK REJECT ... Expected return ...% < min ...%`. Combined with VPS Claude's MIN_CONFIDENCE gate (`79eed18`), trade frequency may drop further. If freq drops to near-zero for >48h, the MIN_EXPECTED_RETURN gate (currently 0.8%) is the lever to relax, not the fee math.
- **Dual-engine equity**: pre-deploy dual-engine equity was over-deducting entry fees. After deploy, equity values for any in-flight dual-engine trades will jump up by the cumulative entry-fee amount on first close. Mostly harmless (dual engine is paper).
- **`[V2 ExitMgr] skipped X` warnings**: should be rare. If one ticker shows up repeatedly, investigate that pair's WS/REST availability.
- **Crypto.com WS**: should see `[WebSocket] Stale connection ... — forcing reconnect` only when there's actual connectivity loss. If it fires constantly, threshold may be too tight — relax `STALE_TIMEOUT_MS`.
- **Telegram alerts** (new failure modes): `[V2] CRITICAL: insertTrade + rollback BOTH failed` requires immediate manual intervention — naked position on Kraken with native SL but no managed exits.

**What's next:**
- **Wave 3** (still BLOCKED on user decisions): C4 auth scheme; C2 V2 native SL bookkeeping (needs schema migration); H1 ML feature count (88 vs 109); H2 ml_features.regime; H3 dual-engine paper trades; H9 core/TradingEngine.ts; H10 arbitrageEngine.
- **Wave 4**: 27 MEDIUM + LOW items.

---

## 2026-05-03 22:00 UTC — Wave-1 audit-driven sweep: 7 fixes (CRITICAL+HIGH) — local-claude

**Commits:** `d661cb2`, `5714526`, `97b7d99`, `5ef0ff5`, `914f3fe`
**Files changed:** `server.js`, `services/exchangeAdapters/krakenAdapter.js`, `services/syntheticLabeler.js`, `v2/pipeline/meanReversionExitManager.ts`, `routes/tradingview.js`
**Stats baseline reset:** no (per CLAUDE.md — bug fixes restoring intended behavior keep continuous stats so the impact is measurable)

**What changed:**
First wave of fixes from a 6-fork audit covering V2 pipeline, core/, ML, exchange adapters, database, server.js+routes. Audit reports identified ~100 issues; this wave is the small unambiguous CRITICAL/HIGH items that didn't need design decisions. Five logical commits:

1. **`d661cb2` — `uncaughtException` flush + dead listener.** Crash handler now calls `dbBatcher.shutdown()` before `process.exit(1)` (SIGTERM/SIGINT already did via gracefulShutdown). Also removed a `tradingBus.on('engine:tick')` listener that received a payload missing the `priceMap` it tried to read — guarded so it didn't crash, but was dead code.
2. **`5714526` — Kraken adapter: BTC pair corruption + monotonic nonce.** `fromKrakenPair('XXBTZUSD')` was producing `BTUSD` (the `XBT->BTC` step never fired because greedy `/^X{1,2}/` ate both X's first). Same bug class in `getBalance` asset normalize. Both now do `XBT->BTC` first then strip prefixes with lookahead so single-X assets like XRP aren't mangled. Separately, `krakenPrivateRequest` now uses a process-lifetime monotonic counter for nonces instead of `Date.now()*1000+attempt` — the old form produced identical nonces under sub-millisecond concurrent calls (multi-strategy V2 issuing concurrent private API calls per tick).
3. **`97b7d99` — syntheticLabeler fail-loud.** Default `FEATURE_COUNT` was 103 fallback; real value is 109. If the dynamic import of `featureEngineering.js` ever failed, every newly built vector (length 109) was silently rejected by the `!== FEATURE_COUNT` check. Default is now `null` so `generateSamples()` short-circuits with a clear error instead of dropping every sample silently.
4. **`5ef0ff5` — MR exit manager trailing reclassification.** Mirror of `8259538`/`a3ccb15` — when the MR stop has been raised above initial (BE/quick-kill fired), label exits as `trailing` instead of `stop_loss`. Two sites in MR; both fixed. Currently dormant (MR disabled) but ready when re-enabled.
5. **`914f3fe` — TradingView webhook default-deny.** When `TRADINGVIEW_WEBHOOK_SECRET` env was unset, the secret check was skipped silently — anyone could inject signals into the 100-entry ring buffer. Now returns 503 when env is missing; opt-in by setting the env.

**Why:**
6-fork audit (yesterday + today) ran broad bug check across the codebase. CHANGELOG patterns from the 4 prior bug-fix rounds (`1705b17` schema drift, `7e80042` double-encode, `fa3e878` exit fee, `8259538` exit reason, `6c9127e` SL rollback) were used as templates to find similar issues elsewhere — and several were found. This wave clears the unambiguous ones; Waves 2-4 still pending (larger fixes that need user decisions on auth scheme, schema migrations, dual-engine design).

**What to monitor / watch for:**
- **BTC orders should now appear correctly in any UI/log that uses `fromKrakenPair`** — if `getOpenOrders` or balance breakdowns previously omitted BTC positions, they should now show. Verify after next BTC trade closes: `SELECT ticker FROM v2_trades WHERE ticker LIKE '%BTC%' ORDER BY entry_time DESC LIMIT 3`.
- **Kraken "Invalid nonce" errors should drop to zero** under multi-strategy load. Search PM2 logs: `pm2 logs canuck-node --lines 200 --nostream | grep -i nonce`.
- **No "Saved model has no scaler data" warnings combined with sample-rejection silence** in syntheticLabeler logs — if featureEngineering.js fails to load, you should now see `[SyntheticLabeler] CRITICAL: ...` instead of silent zero-sample runs.
- **TradingView webhook**: if you previously called this without setting the env var, it now returns 503. Set `TRADINGVIEW_WEBHOOK_SECRET` to re-enable.
- **MR exit reasons stay clean** — `EXIT_REASON.trailing` count for MR should be 0 today (engine disabled); when MR re-enables, the breakdown will be accurate from the start.

**What's next (deferred to user):**
- **Wave 2** (larger CRITICAL/HIGH, no input needed): C1 (cancelOrder signature double-fill on Crypto.com), C3 (Dead Man's Switch never wired), H4 (insertTrade rollback), H5 (per-trade try/catch in V2 exitManager), H6 (3 more fee-accounting sites), H7 (V2 fees always Kraken even when Crypto.com active), H13 (NaN/zero imputation), H14 (Crypto.com WS staleness).
- **Wave 3** (BLOCKED on user decisions): C4 auth scheme (localhost-only vs API key vs gate-worst-only); C2 V2 native SL bookkeeping (needs schema migration); H1 ML feature count (88 vs 109); H2 ml_features.regime (is regime even used?); H3 dual-engine paper trades (fix vs document); H9 core/TradingEngine.ts (delete vs patch); H10 arbitrageEngine multiple.
- **Wave 4**: 27 MEDIUM + LOW items — defer to a later sweep.

**Note on coordination:** during this sweep, vps-claude pushed `79eed18` (MIN_CONFIDENCE enforcement) at ~18:00 UTC. Picked up via `git fetch origin`, integrated cleanly via rebase (only CHANGELOG conflict, which was the predictable interleave). The bidirectional CHANGELOG system worked as designed — VPS Claude's entry gave full context for the trading-config change without a sync call.

---

## 2026-05-03 ~18:00 UTC — Enforce MIN_CONFIDENCE at signal gate (was dead code) — vps-claude

**Commits:** `79eed18`
**Files changed:** `v2/pipeline/signalGenerator.ts`
**Stats baseline reset:** no (this is a filter tightening — want to see the contrast vs. prior trades in continuous stats)

**What changed:**
`MIN_CONFIDENCE: 0.70` in config was never checked — the signal gate only checked `MIN_COMPOSITE_SCORE: 60`, allowing entries at confidence 0.60+. Added `&& confidence >= V2_CONFIG.MIN_CONFIDENCE` to the pass condition. Also added `confNote` to rejection log messages so filtered-out trades show the confidence shortfall.

**Why:**
Post-baseline data (9 trades) showed 6 of 9 entries had confidence 0.61–0.69, below the intended 0.70 threshold. These low-conviction entries accounted for most of the -$6.60 PnL drag (especially time_kill losses on stagnant positions). The 3 trades that would have passed the 0.70 gate included the two best wins.

**What to monitor / watch for:**
- **Trade frequency will drop** — most signals score 60–69 and will now be rejected. Watch for `[V2] REJECT` logs showing `conf=0.6x<0.7` to confirm the filter is working.
- **Win rate and avg PnL should improve** — only higher-conviction setups get through.
- **If trade frequency drops to near-zero** for >48h, the threshold may be too aggressive. Fallback: lower `MIN_CONFIDENCE` to 0.65 in config.ts.
- Rollback: revert the single commit.

---

## 2026-04-30 16:00 UTC — Cleanup sweep: 4 deferred bugs fixed (incl. real ML save bug) — local-claude

**Commits:** `1232a8d`, `a3ccb15`, `ee1b5bd`, `7e80042`
**Files changed:** `v2/engine/bearishServices.ts`, `services/exchangeAdapters/cryptocomAdapter.js`, `v2/pipeline/momentumExitManager.ts`, `v2/engine/config.ts`, `services/mlPredictionService.js`
**Stats baseline reset:** no (per CLAUDE.md — bug fixes / refactors / log cleanups keep continuous stats)

**What changed:**
1. **`1232a8d` — Crypto.com auth log noise (#31).** Two changes: bearishServices checks `SESSION_API_KEY/SECRET_KEY` env upfront and skips silently if missing (avoids triggering the adapter's auth-error chain). cryptocomAdapter's 40101 warning rewritten to "credentials invalid or expired" — was misleadingly saying "not configured" when keys were present but rejected. Both warnings remain once-per-process via existing guards.
2. **`a3ccb15` — MOMENTUM exit reclassification (#28).** Mirror of `8259538`'s fix to momentumExitManager — when stop has been raised above initial, label as `trailing` instead of `stop_loss`. Currently dormant (MOMENTUM disabled) but ready for when strategy is reworked.
3. **`ee1b5bd` — Centralize MOM_EXIT_CONFIG (#29).** Hardcoded config object moved from momentumExitManager.ts into v2/engine/config.ts as `MOM_EXIT_CONFIG`. No behavior change. Tuning consistency with TREND/MR.
4. **`7e80042` — REAL bug found while investigating #32.** mlPredictionService was wrapping `engine.serialize()` (already a JSON string) in `JSON.stringify(...)`, producing double-encoded JSON in the DB. Caused `deserialize()` to parse a string and emit "Saved model has no scaler data" on every restart. Verified in DB: model id=4 (older path) was correctly single-encoded with scaler.means.length=103; models id=380+ (recent worker path) started with `"{\"version\"...` instead of `{"version":...`. Two save sites fixed, both at the worker callback and the inline training path.

**Why:**
User-requested cleanup of all deferred items from bug inventory. Items #28 (MOMENTUM exit) and #29 (MOMENTUM config) were known dormant issues. #31 (Crypto.com noise) was a clarity fix. #32 looked like a minor "scaler not persisted" issue — turned out to be a substantive double-encoding bug that broke model restoration entirely.

**What to monitor / watch for:**
- **No more "Saved model has no scaler data" warnings on restart** — should appear once for the next restart (still loading id=385 which is double-encoded), then disappear after the next training cycle saves a correctly-encoded model. Verify by querying: `SELECT id, substr(model_data, 1, 5) FROM ml_models ORDER BY id DESC LIMIT 5;` — new entries should start with `{"ver` (single-encoded), not `"{\\"`.
- **Crypto.com auth warning wording is now more accurate** — should say "credentials invalid or expired" instead of "not configured" when keys are present but rejected.
- **MOMENTUM engine should remain disabled** — boot logs show `[V2] Momentum engine disabled` and no MOM trades open.
- **#30 (MOMENTUM signal redesign) deferred** — discussed with user; this is a strategy rebuild not a bug fix. Will revisit if/when MOMENTUM is to be re-enabled with a new approach (e.g., 15m timeframe with histogram acceleration).

---

## 2026-04-29 19:30 UTC — Round-3 bug sweep: schema migration + 2 more fixes — local-claude

**Commits:** `1705b17`, `fa3e878`
**Files changed:** `v2/attribution/attributionStore.ts`, `v2/pipeline/momentumExitManager.ts`, `v2/pipeline/breakoutExitManager.ts`, `v2/pipeline/meanReversionExitManager.ts`, `v2/engine/tradeEngine.ts`
**Stats baseline reset:** no (per CLAUDE.md — bug fixes restoring intended behavior keep continuous stats so the impact is measurable)

**What changed:**
1. **`1705b17` — Schema migration: persist `atrPercent`, `peakPrice`, `peakHistogram`.** These were declared on the V2Trade type and set on entry, but missing from the v2_trades schema. So every loop after entry, the trade was loaded with these as `undefined`. Knock-on effects (verified):
   - **TREND quick-kill stop tightening NEVER fired.** Condition `trade.atrPercent != null` was false on every loaded trade. Verified: 0/94 closed TREND trades had a stop tightened below entry. Recent QUICK_KILL_AFTER_MS tuning (8h → 4h) was doing nothing.
   - **TREND ATR-aware trailing-giveback NEVER applied.** Just constant 0.25 giveback regardless of vol.
   - **MOMENTUM histogram-decay exit could never trigger** (peakHist always = currentHist). Dormant — MOMENTUM disabled.
   - **BREAKOUT chandelier and MR peak-trailing similarly broken.** Both dormant.
   - Fix: idempotent ALTER TABLE adds 3 columns, insertTrade/rowToTrade updated, new `updateTradePeakPrice` / `updateTradePeakHistogram` helpers wired into the 3 exit managers that mutate peaks. Old rows (NULL columns) handled by existing `?? entry`/`!= null` fallbacks.

2. **`fa3e878` — Exit fee accounting + ML gatekeeper logging.**
   - **Exit fee:** was computing maker fee for take_profit/trailing exits, but actual exit path always uses `placeMarketSell` (taker). Recorded P&L over-stated by ~0.10% per planned exit. Now: always use FEE_TAKER_PERCENT to match reality.
   - **ML gatekeeper:** changed `} catch { /* swallow */ }` to log a warning (capped at 1/30 loops). The existing catch hid both "ML not configured" *and* real evaluation bugs.

**What to monitor / watch for:**
- **Quick-kill should now actually fire.** Look for trades with `current_stop > initial_stop AND current_stop < entry_price` after 4+ hours of no profit. Query: `SELECT id, ticker, ROUND(current_stop,4), ROUND(initial_stop,4), ROUND(entry_price,4) FROM v2_trades WHERE status='closed' AND current_stop > initial_stop AND current_stop < entry_price AND entry_time > 1777485600000;` — should produce non-zero count over coming days.
- **Schema migration:** boot logs should show no errors. Verify columns exist via `PRAGMA table_info(v2_trades)` — should include atr_percent, peak_price, peak_histogram REAL.
- **New entries should populate the new columns.** Query `SELECT atr_percent, peak_price FROM v2_trades WHERE entry_time > <baseline>` — should see non-null values for trades after this deploy.
- **ML bypass warnings** in logs would indicate gatekeeper failure — investigate if observed.
- **Old trades** keep NULL for new columns; that's expected and safe.

---

## 2026-04-29 19:00 UTC — Round-2 bug sweep: 3 more fixes (incl. MOMENTUM regression) — local-claude

**Commits:** `30762ff`, `09746f4`, `6c9127e`
**Files changed:** `v2/index.ts`, `v2/engine/momentumEngine.ts`, `v2/pipeline/executor.ts`
**Stats baseline reset:** no (per CLAUDE.md — bug fixes restoring intended behavior keep continuous stats)

**What changed:**
1. **`30762ff` — Re-disable MOMENTUM engine.** This was a regression from my own 17:39 UTC force-push to the VPS bare repo: VPS Claude's `2a96f56` (MOMENTUM disable) lived only on the bare repo and got overwritten when I pushed my origin history. The MOMENTUM init/start calls returned to v2/index.ts. Engine has been "running" for 4 days but produced 0 trades due to market conditions — pure luck. Now restored to disabled state, mirroring `2a96f56`'s edit.
2. **`09746f4` — Set MOMENTUM `takeProfitTarget` to SL-mirror sentinel.** Was 0, which broke analytics queries (R:R formula produced -70.04 for SOL entries). Now: `entry + atrDollar * SL_ATR_MULT` (mirrors SL distance, R:R = 1.0). Functionally identical at runtime since `momentumExitManager` doesn't read the field; purely fixes analytics.
3. **`6c9127e` — Live-mode SL retry + rollback in executor.** Previously a `placeStopLoss` failure was logged but the trade was kept — leaving a real exchange position with no native SL, exposed if the bot crashed. Now: 3-attempt retry with 1s/2s/4s backoff, market-sell rollback if all fail, CRITICAL log if rollback also fails. Currently masked by paper mode but ready for live transition.

**Why:**
Round-2 audit (user-requested "nothing too small to mention" check) caught the MOMENTUM regression, which was the most important finding by far. The other two are low-impact correctness/hardening fixes.

**What to monitor / watch for:**
- **MOMENTUM should NOT log "Momentum engine started" or open trades.** Boot log should now show `[V2] Momentum engine disabled (0% WR over 7 trades, buying overbought)`. If MOMENTUM trades appear in `v2_trades` with `entry_time > 1777485600000`, the regression returned — revert `30762ff` is not the fix; investigate why the disable didn't take.
- **Exit reason classification fix from earlier (`8259538`) and this batch's MOMENTUM fixes both deployed in the same window.** Use `WHERE entry_time > <baseline>` to isolate cohort.
- **Future force-pushes:** before any force-push to vps remote, check whether the bare repo has commits ahead that aren't in origin. The CHANGELOG system + this lesson should prevent silent commit loss going forward.

**Process improvement:** the MOMENTUM regression is exactly what the new CHANGELOG.md system is designed to catch. Each entry from now on should help surface multi-agent state drift earlier.

---

## 2026-04-29 18:30 UTC — Bug-fix sweep (5 issues) + bidirectional changelog system — local-claude

**Commits:** `8259538`, `0e30f19`, `6cd1e24`, plus this changelog + CLAUDE.md handoff rule
**Files changed:** `v2/pipeline/exitManager.ts`, `v2/pipeline/riskGate.ts`, `v2/engine/positionManager.ts`, `v2/engine/tradeEngine.ts`, `CHANGELOG.md` (new), `CLAUDE.md`
**Stats baseline reset:** no (per CLAUDE.md — bug fixes restoring intended behavior keep continuous stats)

**What changed:**
1. **`8259538` — Exit reason classification:** when `currentPrice <= currentStop` AND the stop has been raised (`trailingActivated` OR `currentStop > initialStop`), label exit as `trailing` instead of `stop_loss`. Also: BE stop in `exitManager.ts:118` no longer has an upper bound on its trigger range (was `< TRAILING_ACTIVATE_PERCENT`, which silently squeezed to a 0.2% window when trailing activation tightened from 0.015 to 0.01). Now BE always tries to set stop floor at entry+0.1%; trailing tightens further if applicable.
2. **`0e30f19` — riskGate defensive guards:** added `isFinite` checks on `positionSizeUsd` (NaN-comparisons-are-false bug), `lastPrice`, and `atrValue` to prevent silent NaN-priced trades from entering the system.
3. **`6cd1e24` — Per-strategy circuit breaker:** `getCircuitBreakerState()` now accepts a `strategy` parameter and filters `getClosedTradesByStrategy()` accordingly. Previously a loss in any strategy would trigger TREND's cooldown.

**Why:**
Routine bug-check sweep (user-requested) found 5 issues in V2 logic. None were causing P&L damage but the misclassified exit reasons were obscuring our analytics — every BE/trailing save was logged as "stop_loss with positive PnL". Fix #2 restores the intended behavior of the BE stop after VPS Claude's earlier `c277bb4` config tweak inadvertently squeezed it. Fixes #3-#5 are defensive hardening (no current instances in DB).

**What to monitor / watch for:**
- **Exit reason distribution should change visibly.** Before: lots of `stop_loss` exits with positive PnL. After: those should now appear as `trailing`. Query: `SELECT exit_reason, COUNT(*), SUM(CASE WHEN pnl_net > 0 THEN 1 ELSE 0 END) wins FROM v2_trades WHERE exit_time > 1777485000000 GROUP BY exit_reason;`
- **BE stop should fire more often** in trades that reach +0.8% but don't get to +1.0% trailing activation. Watch for trades exiting near entry+0.1% via `trailing` reason (those are BE saves under the new label).
- **Per-strategy circuit breaker:** currently masked because only TREND is enabled. If MOMENTUM or MEAN_REVERSION are re-enabled, verify their lossy trades don't pause TREND.
- **Rollback any single fix** with `git revert <SHA>` (8259538, 0e30f19, or 6cd1e24).

---

## 2026-04-29 17:39 UTC — Loss mitigation package (3 commits) + stats baseline reset — local-claude

**Commits:** `5827dd5`, `254dce6`, `79656ff`, plus design doc `39d0e71`
**Files changed:** `v2/engine/config.ts`, `docs/plans/2026-04-29-loss-mitigation-package-design.md`
**Stats baseline reset:** **YES, new baseline = 1777484345000** (2026-04-29 17:39:05 UTC)

**What changed:**
1. **`5827dd5` — Ticker swap:** removed BTCUSD (0/3 = 0% WR live), added DOTUSD (75% WR) and ADAUSD (60% WR). New scan list: ETH, XRP, DOGE, DOT, ADA.
2. **`254dce6` — Re-allowed STRONG_UP regime:** `ALLOWED_REGIMES: ['UP'] → ['STRONG_UP', 'UP']`. Previous block was based on R:R 0.8 era data; at R:R 1.4 STRONG_UP showed 60% WR break-even.
3. **`79656ff` — Widened TP from 1.4:1 to 1.6:1 R:R:** `TAKE_PROFIT_ATR_MULT: 3.5 → 4.0`. Experimental — historical R:R 1.6 cohorts underperformed but those were before BE/trailing fixes were in place.

**Why:**
Per analysis in `docs/plans/2026-04-29-loss-mitigation-package-design.md`. R:R 1.4 cohort (54 closed trades) was -$7.38 net with avg_win < avg_loss. Per-ticker analysis showed losses heavily concentrated in BTCUSD, while removed-tickers DOT/ADA were actually winners in live data. STRONG_UP block was based on stale config-era data.

**What to monitor / watch for:**
- **Post-baseline cohort:** primary stats use `WHERE entry_time >= 1777484345000`. Legacy trades reported separately.
- **R:R should be 1.6 on new TREND entries** (was 1.4). Any 0.8 entries are regressions from `79656ff`; revert that commit.
- **Per-ticker WR:** DOT and ADA should deliver on their 60-75% historical WR. BTCUSD entries should not appear (would be regression from `5827dd5`).
- **STRONG_UP entries should perform comparably to UP.** If significantly worse (per-trade), revert `254dce6`.
- **TP widening test:** wide-TP avg_win should rise meaningfully from R:R 1.4 baseline of $0.97. If WR drops or avg_win doesn't improve after 10+ post-baseline closes, revert `79656ff` (the experimental commit).
- Each commit independently revertable.

---

## 2026-04-29 13:42 UTC — Tune exit params + disable MR engine + remove SOLUSD — vps-claude

**Commits:** `c277bb4` (relayed to origin via patch as `c277bb4`)
**Files changed:** `v2/engine/config.ts`, `monitor.sh`
**Stats baseline reset:** no (predates the standing rule)

**What changed:**
- TRAILING_ACTIVATE_PERCENT: 0.015 → 0.01
- TRAILING_GIVEBACK_PERCENT: 0.30 → 0.25
- TIME_KILL_MS: 16h → 12h
- QUICK_KILL_AFTER_MS: 8h → 4h
- SOLUSD removed from SCAN_TICKERS
- TP=5.0 ATR experiment then reverted to 3.5
- MR_CONFIG.ENABLED: true → false (0/4 WR live, -$2.80)

**Why:** Per VPS Claude's analysis of live trade outcomes during the 3-day window after the brace-bug fix.

**Note:** The TRAILING_ACTIVATE_PERCENT change inadvertently squeezed the BE stop window — fixed in subsequent `8259538` commit.

---

## 2026-04-25 23:31 UTC — Fix broken brace structure that crashed V2 engine for 3 days — vps-claude

**Commits:** `5561e1e` (on VPS bare repo, not on origin)
**Files changed:** `v2/index.ts`
**Stats baseline reset:** n/a

**What happened:** The MOM disable edit (`2a96f56`) left a stray `try {` block that broke the module parse. Node's TS stripper rejected the file with `ERR_INVALID_TYPESCRIPT_SYNTAX`. PM2 showed "online" but the V2 engine loop never started — 4 positions left unmanaged for 3 days with no exit checks.

**Lesson:** Startup-time parse errors are NEVER non-blocking when they occur before the work loop initializes. Local Claude misclassified this as "non-blocking" in an earlier progress report.

---

## 2026-04-22 13:31 UTC — Disable MOMENTUM engine — vps-claude

**Commits:** `2a96f56`
**Files changed:** `v2/index.ts`
**Stats baseline reset:** n/a

**What:** Disabled MOMENTUM engine (7 trades, 0 wins, -$9.78 net). MACD histogram spikes on 1h candles catch end-of-move exhaustion, not initiation.

---

## 2026-04-21 15:39 UTC — Initial fix package: R:R restoration, BE stop revival, STRONG_UP block — local-claude

**Commits:** `6868c42`, `83cf3b1`, `6166dae`
**Files changed:** `v2/engine/config.ts`
**Stats baseline reset:** n/a (predates the standing rule)

**What:**
- `6868c42` — TRAILING_ACTIVATE_PERCENT: 0.008 → 0.015 (revives the dead BE stop code path)
- `83cf3b1` — TAKE_PROFIT_ATR_MULT: 2.0 → 3.5 (restores 1.4:1 R:R from inverted 0.8:1)
- `6166dae` — ALLOWED_REGIMES: ['STRONG_UP', 'UP'] → ['UP'] (blocked STRONG_UP — 36% WR / -$38 in R:R 0.8 era)

**Why:** First systematic V2 fix package. Identified that R:R was inverted (every trade structurally negative) and BE stop had a `>= 0.008 AND < 0.008` impossible condition.

**Note:** The STRONG_UP block was later re-evaluated and reversed in `254dce6` after analysis showed the original block was based on stale R:R 0.8 era data.
