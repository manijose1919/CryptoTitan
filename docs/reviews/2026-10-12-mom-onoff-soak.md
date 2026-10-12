# 2026-10-12 — MOMENTUM on/off after scan-parity + dual-watchdog soak

## Soak (:3137)
- Midday resume after ~41440s suspend:
  - `[V2] Watchdog kick` + `[Bearish] Watchdog kick` both fired
  - WS Connected→Subscribed→online — **no 1006**
- mode=paper; open 0; cohort 0; risk-off/SIDEWAYS; DOTUSD UP only
- Dashboard `/` 200; shorts off / DCA sim; F&G ~66

## Research (`edge-mom-onoff-9045`)
Locked stack + MOMENTUM scan PASS (2026-10-10 fix). Compare MOMENTUM enabled vs disabled on fee-aware 90/45.

| Ablation | Earlier n/PF/net | OOS n/PF/net | momTrades |
|---|---|---|---|
| mom_on | 6 / 0.455 / −$10.94 | 4 / 2.04 / +$5.11 | **0** |
| mom_off | 6 / 0.455 / −$10.94 | 4 / 2.04 / +$5.11 | **0** |

**Identical.** After scan-parity, MOMENTUM adds **no** 4h trades under this stack — prior “MOMENTUM helps OOS” was from out-of-band (over-ATR) fills.

## Decision
- No promote. Keep MOMENTUM enabled in paper (live path + future in-band coincidence); do not rely on it for 4h research n/PF.
- Note: paper also evaluates **1h** TREND/MOMENTUM; research baselines remain 4h-only (1h history still ~30d via Kraken public — robust 90/45 blocked).
- Continue soak on locked stack; dual watchdogs validated twice.
