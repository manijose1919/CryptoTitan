# 2026-10-09 — Kraken WS stale-close race after VM suspend

## Soak
- `:3137` paper; open 0; risk-off; watchdog kicks ~11–12h after suspend.
- Pattern in logs: `Dead for ~41ks — forcing reconnect` → Connected / Subscribed / System status online → **Disconnected (code: 1006)** immediately.

## Root cause
Heartbeat dead-detect correctly kills the pre-suspend socket, but:
1. `checkHeartbeat` called `ws.close()` **without** removing listeners, then `ws = null`.
2. The dying socket’s `close` handler still ran and cleared `connected` / `heartbeatTimer` / scheduled another reconnect — racing the successor socket.
3. `connect()` cleanup could also `close()` a brand-new OPEN socket if a stale close path interleaved.

## Fix
- Capture socket per connection; ignore close/message/error when `ws !== socket`.
- `disposeSocket`: `removeAllListeners` + `terminate` before replace.
- Heartbeat force-kill detaches listeners first, then schedules reconnect.
- Unit test: `tests/krakenWebsocketService.staleClose.test.ts`.

## Decision
Ship to paper (restart `:3137`). No trading-config change. Watch next suspend for connect-without-immediate-1006.
