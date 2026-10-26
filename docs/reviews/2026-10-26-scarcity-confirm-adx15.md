# 2026-10-26 midday — scarcity refresh + confirm ablation (no promote)

## Soak
- `:3137` paper; open 0; cohort 0; pnl −$64.72; F&G ~59 Neutral.
- BNBUSD **UP** ATR% ~0.96–0.99 &lt; min 1.5; rest DOWN/STRONG_DOWN.
- ~41688s suspend → WS reconnect; mode=paper; `V2_LIVE_CONFIRMED=no`; DCA sim-only; shorts off.
- GUI `/` + `/api/health` 200.

## Scarcity (ADX≥15, ATR [1.5,2.8], vol≥0.20, pre-confirm)

| window | SU band+vol | UP band+vol | UP+ADX lowATR |
|---|---|---|---|
| earlier90 | 396 | 417 | 520 |
| oos45 | 156 | 135 | 159 |
| earlier60 | 236 | 171 | 404 |
| oos60 | 217 | 264 | 232 |
| **recent30** | **15** | **13** | **72** |

Recent 30d: only **28** ticker-bars clear ADX+ATR-band+vol; **72** UP+ADX bars sit below minATR (BNB-style). Explains sterile soak without justifying minATR soften (already rejected).

## Confirm-mode + confirmMomentum under paper stack

| variant | dual | Σnet |
|---|---|---|
| **paper bullish_close + mom** | **PASS** | **$215.5** |
| bullish_close, mom off | PASS | $216.9 (+$1.4) |
| close_above_signal + mom | PASS | $216.3 (+$0.9; earlier60 14→12) |
| bullish_and_above + mom | PASS | $212.4 |
| confirm off + mom | **FAIL** | $113.9 (oos45 PF 0.87) |

**No promote** — mom-off / close_above are micro Σnet only (or n-starve). Confirm-off fails promote bar. Keep `bullish_close` + `confirmMomentum`.

## Decision
No trading-config change. Stack remains locked; wait for in-band UP/STRONG_UP.

## Code / artifacts
- `scripts/edge-scarcity-adx15-9045.ts`
- `scripts/edge-confirm-adx15-stack-9045.ts`
