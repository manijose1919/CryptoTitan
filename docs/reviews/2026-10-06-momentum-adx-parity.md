# 2026-10-06 — MOMENTUM ADX parity (AVAX contamination)

## Incident
Paper `:3137` loop #61:

```
[V2] ADX block 4h: AVAXUSD ADX 15.2<20
[V2] Loop #61: 1 signals: [AVAXUSD/MOMENTUM/4h=0.75]
[V2] Trade opened: AVAXUSD @ $11.67 qty=18.200181
```

TREND correctly refused AVAX (ADX 15.2 &lt; 20). MOMENTUM used the same scan-PASS path **without** the ADX gate and filled immediately (~$212). Confirm is TREND-only in `tradeEngine`, so MOMENTUM also skipped the promote confirm bar.

## Fix
- `strategyRunner`: shared ADX≥`TREND_MIN` filter for TREND **and** MOMENTUM.
- `backtestEngine`: MOMENTUM fallback honors `entryFilters.minAdx` the same way TREND does.
- Regression: `v2/engine/strategyRunner.adxParity.test.ts`.

## Contaminated trade
| Field | Value |
|---|---|
| id | `f69f31c0-ae44-4c4f-b7c2-901bb279b35a` |
| ticker / strategy / tf | AVAXUSD / MOMENTUM / 4h |
| entry | 2026-10-06 12:14:52 UTC @ $11.6708325 |
| size | ~$212.41 |
| entry_regime / ATR% | STRONG_UP / 1.888 |
| ADX at signal | **15.2** (would block under fixed gate) |

**Treat as contaminated.** Leave to natural exit (stops/trail/time-kill). Do **not** count toward post-baseline STRONG_UP+confirm+ADX20 cohort stats. No baseline reset (bugfix, not intentional config change).

## Follow-ups (not shipped)
- MOMENTUM still bypasses pending-confirm (`useConfirm && strategy === 'TREND'` only). Consider confirm parity after ADX soak settles.
- Health `openPositions` counts TREND-only (`getOpenTradesByStrategy('TREND')`) — MOMENTUM opens can look like 0 opens while `v2_trades` has status=open.
- BREAKOUT also lacks the shared ADX gate (out of scope this cycle).
