# 2026-10-11 — Soak resume + conf-tighten (no promote)

## Soak (:3137)
- Post-suspend (~41331s WS dead): Connected → Subscribed → online — **no 1006**.
- Watchdog: `recovery loop already in flight — skip kick` (benign).
- mode=paper; open 0; cohort 0; shorts off / DCA sim; F&G ~64 Mild Greed.
- **DOTUSD STRONG_UP** but `ATR% 2.700 > max 2.5` — correctly rejected (same class as ADA 2026-10-06). Do **not** raise MAX_ATR for the near-miss.

## Research: tighten-only conf/score (`edge-conf-tighten-9045`)
Locked stack + MOMENTUM scan parity. Hypothesis: earlier90 BNB stop at conf≈0.653 is low-conf drag.

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper conf0.65 | 6 / 0.455 / −$10.94 | 4 / 2.04 / +$5.22 | no |
| conf0.68 | 4 / **1.76** / +$3.93 | 3 / 1.35 / +$1.72 | no (n) |
| conf0.70 | 3 / 1.65 / +$3.37 | 3 / 1.35 | no |
| conf0.72 | 2 / 4.74 / +$6.75 | **0** / — | no (OOS empty) |
| score68+conf0.68 | = conf0.68 | = conf0.68 | no |
| score70+conf0.70 | = conf0.70 | = conf0.70 | no |

**anyPromote = false.** Tightening flips earlier PF positive by dropping the BNB stop, but cuts n further and thins OOS — fails the bar.

## Decision
No paper config change. Keep conf0.65 / score60 / MAX_ATR=2.5. Continue soak on locked stack; prefer n-raising paths that are not ATR/regime loosen (still blocked by scarcity) or wait for more STRONG_UP+ATR-band coincidence.
