# 2026-10-18 midday — Scarcity refresh + multiStrategy conf parity

## Soak
- `:3137` paper; mode=paper; open 0; pnl −$64.72; trades 6 (cohort 0).
- Regimes: BTC SIDEWAYS, rest DOWN–STRONG_DOWN; F&G 48 Neutral.
- Dual interlock OK; GUI 200; shorts/arb/staking off; DCA sim-only.
- Prior suspend ~41829s: WS reconnect + V2 benign skip (recovery loop in flight).

## Locked baseline (static weights)
Stack: STRONG_UP + confirm + chase0.8 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum.

| Split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=7 WR43% net−$10.72 PF0.466 | n=1 WR100% net+$1.81 | **false** |
| 60/60 | n=4 WR75% net+$3.90 PF1.717 | n=8 WR75% net+$6.16 PF1.559 | **false** (earlier n&lt;10) |

Still fails promote bar (OOS PF&gt;1.1 & net&gt;0 & earlier PF≥0.9 & earlier n≥10).

## Regime scarcity refresh (`edge-regime-scarcity-diag`)

| Window | STRONG_UP | SU+ADX≥20 | SU+ADX+ATR1.5–2.5 | UP+ADX≥20 |
|---|---|---|---|---|
| earlier60 | 301 | 273 | **135** | 436 |
| oos60 | 438 | 428 | **175** | 513 |
| earlier90 | 681 | 639 | 326 | 682 |
| oos45 | 304 | 297 | 113 | 313 |

vs 2026-10-08 (earlier60 121 / oos60 307): calendar roll narrowed the gap (~1.3× vs ~2.5×) but earlier60 still scarcest; 60/60 n≥10 remains structural under locked stack.

## Confidence parity
- Paper TREND path: `generateSignals` enforces `MIN_CONFIDENCE=0.65`.
- multiStrategy `detectTrend` only checked `minCompositeScore` (60) + TimeGate boost → admitted 55–64 that live rejects.
- **Fix:** gate multiStrategy TREND on `V2_CONFIG.MIN_CONFIDENCE` (test-first). Does not change paper runtime (already gated); closes research-path optimism.

## Decision
No trading-config change. Shorts stay off. Keep locked stack soak.
