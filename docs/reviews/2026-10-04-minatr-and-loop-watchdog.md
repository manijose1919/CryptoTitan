# 2026-10-04 — minATR ablation + wall-clock loop watchdog

## Paper soak
- mode=paper, stale recovered after another ~11.5h VM suspend (`KrakenWS Dead for 41383s`).
- Anomalous SOLUSD long (suspend skip-bar fill) still open: entry $119.30, trailing stop ~$121.54, peak ~$121.7, unrealized ≈+1.9%. Contaminated cohort evidence — do not promote on its P&L.
- Scanner ATR-starved: BTC/ETH/BNB/SOL all ATR% &lt; 1.5; no new CONFIRM path this cycle.

## Question (research)
Does lowering minATR to 1.25/1.0 under the promote package clear robust 90/45 with more trades than live 1.5?

## Protocol
- Runner: `scripts/edge-minatr-9045.ts`
- Fixed: UP+STRONG_UP, MAX_ATR=2.5, bullish_close, chase≤0.80
- Bar: OOS PF&gt;1.1 & net&gt;0 & earlier PF≥0.9 & earlier n≥10

## Results (90/45)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| minATR≥1.0 | 20 / 1.199 / +$6.79 | 22 / 2.368 / +$40.15 | yes |
| minATR≥1.25 | 20 / 1.199 / +$6.79 | 22 / 2.368 / +$40.15 | yes |
| **minATR≥1.5 (live)** | **20 / 1.199 / +$6.79** | **22 / 2.368 / +$40.15** | **yes** |
| minATR≥1.75 | 17 / 1.803 / +$17.94 | 17 / 2.369 / +$34.33 | yes |
| no minATR | 20 / 1.199 / +$6.79 | 22 / 2.368 / +$40.15 | yes |

Tighter floor (1.75) cuts n and does not unlock new OOS edge vs 1.5.

**Decision: keep minATR=1.5.** On this window, 1.0–1.5 and “off” are identical — confirm/chase/MAX_ATR bind first. Loosening the scanner floor would not have added historical trades and is a risk-gate loosen without OOS gain.

## Ops fix: loop watchdog
Recurring VM suspend leaves `lastLoopAt` wall-clock stale while Node timers are frozen. Added `v2/engine/loopWatchdog.ts`:
- Kick `runLoop` when `lastLoopAt` age &gt; 3× `BOT_LOOP_INTERVAL_MS`
- Force-unlock `loopInProgress` if held &gt; 5 min

Wired into `startV2Engine` / `stopV2Engine`. No trading-parameter change.
