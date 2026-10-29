# 2026-10-29 midday — maxOpen + Friday under TG[13] (no promote)

## Soak
- `:3137` paper; TG`[13]`; baseline `1793148229501`; open 0; cohort 0.
- Market flipped: all DOWN/SIDEWAYS (XRP/BNB no longer UP); F&G ~58 Neutral.
- ~41105s suspend → WS reconnect; mode=paper; `V2_LIVE_CONFIRMED=no`.
- History: 6 closed (5 losses + SOL UP trailing **+$0.86**); pnl −$64.72.

## MAX_OPEN_POSITIONS (paper=3)

| variant | dual | Σnet |
|---|---|---|
| max 2 | PASS | $194.2 (+$5.5) |
| **paper 3** | **PASS** | **$188.7** |
| max 4 | PASS | $188.7 (identical to paper) |
| max 5 | PASS | $188.7 (identical to paper) |

Max 4/5 unused under this sample (cap not binding). Max 2 micro Σnet lift with slightly fewer OOS60 trades (30 vs 31). **No promote** — keep 3 (historical correlation rationale; lift too small for stress sprint).

## Friday block

| variant | dual | Σnet |
|---|---|---|
| **paper Fri** | **PASS** | **$188.7** |
| no Friday | PASS | $164.1 |
| Fri+Mon | **FAIL** | $104.7 (oos45 PF 0.79) |

**Keep Friday.** Unblocking Friday hurts Σnet; adding Monday fails OOS PF.

## Decision
No trading-config change.

## Code / artifacts
- `scripts/edge-maxpos-adx15-tg13-9045.ts`
- `scripts/edge-friday-adx15-tg13-9045.ts`
