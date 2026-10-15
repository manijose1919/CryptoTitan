# 2026-10-15 — Dual-watchdog benign skip; conf-soften elasticity (no promote)

## Soak (:3137)
- ~30341s suspend: V2 **benign skip** (recovery loop in flight); WS Dead→Connected **no stale 1006 cascade**. Mid-session 1006s were clean reconnects.
- mode=paper; open 0; cohort 0; deep risk-off (STRONG_DOWN/DOWN); F&G ~46 Neutral.
- Health fields live: `wsLastConnectedAt` / `wsLastMessageAgeMs`. Shorts off / DCA sim. GUI 200.

## Locked baseline refresh
Still fails promote: earlier90 PF 0.455 n=6; OOS45 n=3 PF 1.36.

## Conf soften (`edge-conf-soften-9045`)
Funnel pointed at score/conf as n compressor — test whether lowering `MIN_CONFIDENCE` alone clears n≥10 **and** earlier PF≥0.9.

| conf | Earlier n/PF/net | OOS n/PF | Pass |
|---|---|---|---|
| **0.65 (paper)** | 6 / 0.455 / −$10.94 | 3 / 1.36 | no |
| 0.63 | 8 / 0.437 / −$12.95 | 7 / 2.23 | no |
| 0.62 | **12** / 0.564 / −$10.92 | 9 / 2.37 | no (PF) |
| 0.60 | 14 / 0.436 / −$18.28 | 9 / 2.37 | no |

**anyPromote = false.** Softening buys earlier n but **earlier PF stays ~0.44–0.56** — quality collapse. Do **not** loosen paper conf.

## Also noted
- Shorts remain off (2026-07 edge decay); not re-probed into paper this cycle.
- Prior neighborhood (conf+range+chase, 2026-10-08) already failed; this isolates conf under the locked stack.

## Decision
No trading-config change. Keep `MIN_CONFIDENCE=0.65`. Wait for STRONG_UP in-band supply.
