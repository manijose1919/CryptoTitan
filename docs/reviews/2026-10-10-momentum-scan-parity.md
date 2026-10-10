# 2026-10-10 — Backtest MOMENTUM must require scan PASS

## Bug
`backtestEngine` MOMENTUM fallback checked ADX alone and skipped `scanMarket` PASS. Paper `strategyRunner` only evaluates MOMENTUM on scan-PASS + ADX≥20 (regime, MIN/MAX ATR, volume).

## Evidence (locked stack autopsy, pre-fix)
OOS45 included DOTUSD atr% **3.33** and ADAUSD atr% **2.69** under `MAX_ATR_PERCENT=2.5` — impossible on paper. Trade ids ended in `M`.

## Fix
- Gate MOMENTUM with `isMomentumScanEligible(scanPassed, adxOk)` (= paper conjunction).
- Apply research `passesSignalAtrBand` when `entryFilters` set.
- Unit test: `backtestEngine.momentumScanParity.test.ts`.

## Re-baseline after fix (still no promote)

| Split | Earlier | OOS (pre → post) |
|-------|---------|------------------|
| 90/45 | n=6 PF 0.455 −$10.94 | n=6→**4** PF 4.50→**2.02** net $17→**$5** |
| 60/60 | n=3 PF 1.69 | n=11→**9** PF 6.79→**4.34** net $29→**$16** |

Earlier half unchanged (those fills were already scan-eligible). OOS was optimistically inflated by out-of-band MOMENTUM.

## Decision
No paper trading-config change (paper already correct). Research baselines from before this fix that counted MOMENTUM without scan PASS are optimistic on OOS — prefer re-runs.
