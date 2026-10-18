# 2026-10-18 — Benign skip soak; confirm-ADX decay diag (no wire)

## Soak (:3137)
- ~41686s suspend: V2 **benign skip** (recovery loop in flight); WS Dead→Connected clean.
- mode=paper; open 0; cohort 0; deep DOWN/STRONG_DOWN; F&G ~48 Neutral.
- Shorts off / DCA sim; GUI 200. Timer OK through ~2026-10-23.

## Locked baseline (static weights)
Unchanged fail: earlier90 n=7 PF 0.466 −$10.72; OOS45 n=1 +$1.81.

## Confirm-bar ADX persistence (`edge-confirm-adx-persist-9045`)
Hypothesis: entries after ADX decays on confirm bar hurt earlier PF.

| Window | signal ADX≥20 | confirm ADX fail | fail % |
|---|---|---|---|
| earlier90 | 3030 | 104 | **3.4%** |
| oos45 | 1366 | 44 | **3.2%** |

Decay is rare and symmetric across windows — not a binding n/PF lever. **Do not wire** a confirm-ADX gate without a full fill ablation that clears the promote bar (unlikely given ~3% incidence vs n=7 earlier).

## Decision
No trading-config change. Keep locked stack; wait for STRONG_UP in-band supply.
