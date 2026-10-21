# 2026-10-21 overnight — Promote: no_overnight + conf0.60 + chase0.85

## Soak
- `:3137` paper; open 0; pnl −$64.72; trades 6; cohort baseline pre-promote.
- Regimes: all SIDEWAYS; F&G ~54 Neutral.
- Suspend ~42000s: WS reconnect + V2 benign skip; `V2_LIVE_CONFIRMED=no`; GUI 200.

## Context
After scarcity flip, `no_overnight` alone cleared fee-aware **90/45** but failed **60/60 earlier n=8**. Neighborhood under locked stack (STRONG_UP+confirm+MAX_ATR2.5+minATR1.5+ADX20+confirmMomentum+static weights) searched conf / chase / Friday while keeping `BLOCKED_HOURS=[13,20]`.

## Results (static weights)

| variant | 90/45 earlier | 90/45 OOS | 90/45 | 60/60 earlier | 60/60 OOS | 60/60 |
|---|---|---|---|---|---|---|
| no_overnight_paper (conf0.65 chase0.80) | n=15 PF1.52 +$12.50 | n=4 WR100% +$18.24 | pass | n=**8** PF2.37 | n=9 PF1.21 | **fail (n)** |
| no_ovn_conf060 | n=17 PF1.57 +$16.09 | n=9 PF1.73 +$8.80 | pass | n=**9** PF1.67 | n=12 PF1.61 | **fail (n)** |
| no_ovn_chase085 | n=16 PF1.54 +$13.04 | n=4 WR100% +$18.24 | pass | n=**9** PF2.43 | n=10 PF1.26 | **fail (n)** |
| **no_ovn_conf060_chase085** | n=18 PF**1.59** +$16.62 | n=9 PF**1.73** +$8.80 | **pass** | n=**10** PF**1.71** +$9.52 | n=13 PF**1.67** +$11.62 | **pass** |

Solo conf0.60 or chase0.85 still leave earlier60 at n=9. Combined package is the only dual-split clear.

## Promote bar (both splits)
- OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10 — **cleared on 90/45 and 60/60**.

## Paper config changes
- `TIME_GATE_CONFIG.BLOCKED_HOURS`: `[0..7,13,20]` → `[13,20]` (Friday still blocked).
- `V2_CONFIG.MIN_CONFIDENCE`: `0.65` → `0.60`.
- `V2_CONFIG.MAX_SIGNAL_CLOSE_LOCATION` / `PROMOTE_ENTRY_QUALITY.maxSignalCloseLocation`: `0.80` → `0.85`.
- Locked stack otherwise unchanged (STRONG_UP-only, confirm, ATR band, ADX≥20, shorts off).

## Code / artifacts
- `scripts/edge-overnight-n-neighborhood-9045.ts`
- Artifact: `/tmp/cryptotitan-artifacts/edge-overnight-n-neighborhood-9045.json`
- Tests: `timeGate.scoreBoost`, `entryDetectors.confidenceParity`, `promotePackage`

## Decision
**Promote** into paper `:3137`. Stats baseline reset on restart. Rollback: restore overnight blocks + conf0.65 + chase0.80 if soak earlier-window quality collapses or new fills show fee-drag.
