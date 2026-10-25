# 2026-10-25 overnight — minATR + conf neighborhoods under ADX15 (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72 history; F&G ~46 Neutral (not blocking).
- BNBUSD **UP** ATR% 0.99 &lt; min 1.5 (recurring near-miss); rest DOWN/STRONG_DOWN.
- ~42268s suspend → WS reconnect; mode=paper; `V2_LIVE_CONFIRMED=no`; shorts off; GUI 200.

## minATR under UP+ADX15+MAX2.8

| variant | dual | Σnet | earlier60 PF |
|---|---|---|---|
| **paper 1.5** | **PASS** | **$211.3** | 2.19 |
| min 1.35 | PASS | $202.4 | 2.01 (worse Σ; still blocks BNB 0.99) |
| min 1.25 | fail | $132.7 | **0.75** (UP drag) |
| min 1.2 | fail | $128.3 | **0.64** |
| min 1.0 | fail | $77.3 | **0.52** |

**Keep minATR 1.5.** Soften either fails dual or loses Σnet without unblocking soak BNB.

## MIN_CONFIDENCE under same stack

| variant | dual | Σnet |
|---|---|---|
| conf 0.55 | PASS | $183.3 |
| conf 0.58 | PASS | $182.4 |
| **paper 0.60** | **PASS** | **$211.3** |
| conf 0.62 | PASS | $193.3 |
| conf 0.65 | PASS | $198.0 |

**Keep conf 0.60** — best Σnet; no better-than-paper dual candidate.

## Decision
No trading-config change. Wait for BNB ATR% ≥1.5 (or other UP/STRONG_UP in-band) under ADX15+MAX2.8.

## Code / artifacts
- `scripts/edge-minatr-adx15-stack-9045.ts`, `scripts/edge-conf-adx15-stack-9045.ts`
