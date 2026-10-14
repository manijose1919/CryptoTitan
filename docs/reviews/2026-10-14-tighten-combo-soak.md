# 2026-10-14 — Dual-watchdog #5 + tighten-combo (no promote)

## Soak (:3137)
- Resume after ~42313s suspend: V2 + Bearish `Watchdog kick`; WS Connected→online **no 1006**.
- mode=paper; open 0; cohort 0; all DOWN/STRONG_DOWN; no STRONG_UP.
- F&G ~47 Neutral. Shorts off / DCA sim.

## Locked baseline refresh
Still fails promote: earlier90 PF 0.455 n=6; OOS45 n=3 PF 1.35; earlier60 n=3.

## Tighten combo (`edge-tighten-combo-9045`)
Stack vol≥0.3 and/or conf≥0.68 (each previously lifted earlier PF alone).

| Ablation | Earlier n/PF/net | OOS n/PF | Pass |
|---|---|---|---|
| paper | 6 / 0.455 / −$10.94 | 3 / 1.35 | no |
| vol≥0.3 | 4 / 0.809 / −$2.02 | 3 / 1.35 | no |
| conf≥0.68 | 4 / **1.76** / +$3.93 | 3 / 1.35 | no (n) |
| vol+conf | 3 / 1.65 / +$3.37 | 3 / 1.35 | no (n) |
| vol+conf+score68 | 3 / 1.65 / +$3.37 | 3 / 1.35 | no |

**anyPromote = false.** Combining tighten knobs clears earlier PF but **reduces n further** — structural earlier-n ceiling unchanged.

## Decision
No paper config change. Shelve further tighten stacking under this stack. Keep locked gates; wait for STRONG_UP+ATR-band supply (or a different n path that is not ATR/regime loosen).
