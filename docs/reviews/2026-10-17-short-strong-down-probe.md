# 2026-10-17 — Dual-watchdog benign skip; STRONG_DOWN short probe (no promote)

## Soak (:3137)
- ~42267s suspend: V2 **benign skip** (recovery loop in flight); WS Dead→Connected clean.
- mode=paper; open 0; cohort 0; DOWN/STRONG_DOWN/SIDEWAYS; F&G ~51 Neutral.
- Shorts off / DCA sim; GUI 200. Timer OK through ~2026-10-23.

## Long locked baseline (static weights)
Still fails: earlier90 n=7 PF 0.466; OOS45 n=1 +$1.81.

## Short probe (`edge-short-strong-down-9045`)
Research-only mirror of strategyRunner shorts: STRONG_DOWN + ADX≥20 + ATR 1.5–2.5 + bearish confirm + chase≤0.80 + CAD fees. **Paper `SHORTS_ENABLED` unchanged (false).**

| Window | n | WR | net | PF | Pass |
|---|---|---|---|---|---|
| earlier90 | **20** | 70% | +$11.21 | **1.30** | earlier bar OK |
| oos45 | 12 | 67% | **−$9.35** | **0.72** | **no** (OOS) |

OOS drag = stop_loss ×3 (−$32.49) outweighing trailing (+$24.05). Matches 2026-07 finding that recent STRONG_DOWN shorts decayed / reverse-signed vs older window.

**pass9045 = false.** Do **not** re-enable paper shorts.

## Decision
No trading-config change. Long locked stack + shorts off. Optional later: short trailing/stop exit research only if pre-registered — not this cycle.
