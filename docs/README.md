# Documentation index

**CryptoTitan is CryptoGod v2.0** — the active continuation of
[CryptoGod](https://github.com/manijose1919/cryptoGod) (that repo is discontinued for further
development). Current runtime posture, CAD ticker allowlist, live interlock, and corrected replay
numbers live in the root [`README.md`](../README.md).

Historical specs below still describe CryptoGod-era experiments (FIL/ICP pairs, MR, sniper, mid-cap
universes). Treat those as audit trail, not as the running configuration. The predecessor docs index
remains at [cryptoGod `docs/README.md`](https://github.com/manijose1919/cryptoGod/blob/master/docs/README.md).

Everything in this directory is a record of a decision — a design that was agreed, a plan that was
executed, an analysis that changed (or explicitly did not change) the configuration. Documents are
kept after they ship, because the reasoning behind a parameter is usually more valuable than the
parameter.

Dates are the date of the document, not of the last edit.

## Architecture

| Document | Summary |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Process model, boot sequence, module-by-module tour of `v2/`, data flow, persistence, configuration, deployment and the constraints that shape strategy design. |

## Design specs

Approved designs, written before the corresponding plan.

| Date | Document | What it decided |
|---|---|---|
| 2026-06-19 | [`superpowers/specs/2026-06-19-dual-mode-adx-engine-design.md`](superpowers/specs/2026-06-19-dual-mode-adx-engine-design.md) | Split the single-strategy scanner into an ADX-gated dual mode: TREND above the ADX threshold, mean reversion below it, so the two strategies stop competing for the same market conditions. |
| 2026-07-14 | [`superpowers/specs/2026-07-14-profitability-sprint-review-design.md`](superpowers/specs/2026-07-14-profitability-sprint-review-design.md) | Designed a batched change set to lift per-trade expectancy by disabling proven-negative segments, and fixed the self-triggering review reminder so a verdict could not silently expire. |
| 2026-07-23 | [`superpowers/specs/2026-07-23-monitoring-dashboard-design.md`](superpowers/specs/2026-07-23-monitoring-dashboard-design.md) | Specified a read-only monitoring GUI over HTTPS with basic auth — deliberately no control actions, so the observability surface cannot become an attack surface. |
| 2026-07-28 | [`superpowers/specs/2026-07-28-repo-documentation-and-cleanup-design.md`](superpowers/specs/2026-07-28-repo-documentation-and-cleanup-design.md) | Designed the sequencing for making the repository publishable: reversible work first, type errors fixed before documentation so the CI badge is honest, history rewrite last behind a backup. |

## Implementation plans

Task-by-task plans derived from the specs above, or from an operational need.

| Date | Document | What it decided |
|---|---|---|
| 2026-03-26 | [`plans/2026-03-26-multi-timeframe-regime.md`](plans/2026-03-26-multi-timeframe-regime.md) | Let 15m `DOWN` tickers through the scanner when the 4h regime is up — the pullback-in-uptrend pattern — at 75% position size and with separate attribution. |
| 2026-04-29 | [`plans/2026-04-29-loss-mitigation-package-design.md`](plans/2026-04-29-loss-mitigation-package-design.md) | Addressed the structural problem that average loss exceeded average win despite a 59% win rate, which was keeping the TREND cohort slightly negative. |
| 2026-05-26 | [`plans/2026-05-26-pairs-deployment-plan.md`](plans/2026-05-26-pairs-deployment-plan.md) | Phased rollout for the FIL/ICP cointegration strategy: paper first, with the `PAIRS_LIVE_CONFIRMED` interlock guarding any move to live. |
| 2026-06-19 | [`superpowers/plans/2026-06-19-dual-mode-adx-engine.md`](superpowers/plans/2026-06-19-dual-mode-adx-engine.md) | Implementation of the dual-mode ADX engine, with the ADX gate placed in both `strategyRunner.ts` and `meanReversionSignal.ts`, and phase 1 validated in production before phase 2 shipped. |
| 2026-07-14 | [`superpowers/plans/2026-07-14-profitability-sprint.md`](superpowers/plans/2026-07-14-profitability-sprint.md) | Config-only change set disabling TREND shorts and other negative segments, with a single stats-baseline reset for the whole batch rather than one per tweak. |
| 2026-07-23 | [`superpowers/plans/2026-07-23-monitoring-dashboard.md`](superpowers/plans/2026-07-23-monitoring-dashboard.md) | Built `GET /api/v2/monitor/summary` behind a pure, unit-tested `buildMonitorSummary()`, plus a self-contained `public/monitor.html`; closed the public port once nginx terminated TLS. |
| 2026-07-28 | [`superpowers/plans/2026-07-28-repo-documentation-and-cleanup.md`](superpowers/plans/2026-07-28-repo-documentation-and-cleanup.md) | The plan this documentation was written under: accurate docs, green CI, no dead stacks, no VPS address in the tree. |

## Reviews and analyses

| Date | Document | What it decided |
|---|---|---|
| 2026-07-14 | [`reviews/2026-07-14-sprint-review.md`](reviews/2026-07-14-sprint-review.md) | Re-ran the cohort verdict at n=38 and superseded the earlier n=15 conclusion — the losing streak that had prompted "no config change" turned out to sit inside a slightly positive cohort. A worked example of why sample size gates the verdict. |
| 2026-07-23 | [`reviews/2026-07-23-atr-floor-and-shorts-analysis.md`](reviews/2026-07-23-atr-floor-and-shorts-analysis.md) | Two questions, both resolved as **no change**. The ATR floor was not causing the trade drought (396 regime rejections, 0 ATR rejections), and the `STRONG_DOWN` shorts edge had decayed and reversed sign two months earlier. |

## Runbooks

| Date | Document | Summary |
|---|---|---|
| 2026-05-26 | [`runbooks/pairs-runbook.md`](runbooks/pairs-runbook.md) | Exact incident procedures for live pairs trading — partial fills, margin critical, ADF degradation, engine crash. Written to be followed literally, because improvising under stress is how single-leg exposure becomes a real loss. |

## Operational

| Document | Summary |
|---|---|
| [`VPS-AGENT.md`](VPS-AGENT.md) | Standing instructions for the autonomous monitoring agent running on the server: what to check each cycle, what it may change on its own, and the actions that require explicit human sign-off. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | The bidirectional handoff record. Every material change gets a top-of-file entry with its commits, files, reasoning and what to monitor — and anyone touching the server reads the recent entries *before* acting, rather than assuming their local checkout matches what is running. |
| [`../CLAUDE.md`](../CLAUDE.md) | Engineering rules and standing operational procedure, including the `stats_baseline_time` reset rule and the dual-remote push requirement. |
