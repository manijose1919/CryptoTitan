# 2026-10-12 — Bearish watchdog validated on soak

## Soak
- `:3137` paper after ~42750s VM suspend; mode=paper; open 0; cohort 0; shorts off / DCA sim.
- F&G ~66 Mild Greed; regimes mostly SIDEWAYS/DOWN; DOTUSD UP (not STRONG_UP).

## Validation (shipped 2026-10-11)
Resume log sequence:
```
[V2] Watchdog kick: lastLoopAt age 42749s — running loop
[Bearish] Watchdog kick: lastEvalAt age 42750s — running eval
[KrakenWS] Dead for 42734s — forcing reconnect
Connected → Subscribed → System status online
```
- Bearish wall-clock kick **fired** (new path).
- WS reconnect **no Connected→1006**.
- Post-resume: loop age fresh; bearish `evalAge` fresh; `wsConnected=true`.

## Decision
No trading-config change. Keep locked stack + both watchdogs. Continue ATR-cooldown research for high-ATR STRONG_UP near-misses (do not raise MAX_ATR).
