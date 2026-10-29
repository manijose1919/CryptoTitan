# 2026-10-29 overnight — scoreBoost dead letter + ATR near-miss scarcity

## Soak
- `:3137` paper; TG`[13]`; baseline `1793148229501`; open 0; cohort 0.
- **XRPUSD UP** ATR% ~1.335 &lt; min 1.5; **BNBUSD UP** ATR% ~1.08 &lt; 1.5; peers SIDEWAYS/DOWN.
- ~41099–41109s suspend → WS + Watchdog; mode=paper; `V2_LIVE_CONFIRMED=no`.
- GUI 200; shorts off; DCA sim-only.

## TimeGate scoreBoost (conf 0.60)

`confidence = compositeScore/100` and `MIN_CONFIDENCE=0.60` ⇒ score must be ≥60. `BOOST_AMOUNT` only lowers the composite floor (60→55) and cannot admit scores 55–59.

| variant | dual | Σnet | fingerprint |
|---|---|---|---|
| paper boost5 [12,14,17,21] | PASS | $188.65 | identical |
| boost0 same hours | PASS | $188.65 | identical |
| boost10 same hours | PASS | $188.65 | identical |
| boost hours empty | PASS | $188.65 | identical |

`deadLetterConfirmed=true`. No config change — keep BOOSTED_HOURS as telemetry only; comment updated.

## ATR near-miss (UP/SU + ADX≥15)

| window | UP+ADX | SU+ADX | ATR [1.35,1.5) | in-band [1.5,2.8] |
|---|---|---|---|---|
| recent14 | 13 | 0 | 0 | 0 |
| recent30 | 34 | 7 | 2 (XRP×2) | 13 |
| oos45 | 351 | 144 | 14 | 200 |
| oos60 | 516 | 334 | 35 | 405 |

oos45 near-miss tickers: BNB 7, SOL 3, ETH 2, XRP 1, DOGE 1. Soak XRP@1.335 / BNB@1.08 — do **not** lower minATR (prior dual evidence keeps 1.5). Recent14 has **zero** in-band bars.

## Decision
No trading-config change. Document scoreBoost dead letter. Wait for ATR% ≥1.5 on UP names.

## Code / artifacts
- `scripts/edge-boost-deadletter-adx15-9045.ts`
- `scripts/edge-atr-nearmiss-adx15-9045.ts`
- comment fix in `v2/pipeline/timeGate.ts`
