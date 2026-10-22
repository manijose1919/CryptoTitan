# 2026-10-22 overnight — Promote minVolumeRatio≥0.20

## Context
After longer-window stress (allPass), stop autopsy under promote+tk4 found 3 stops in 150d:
- **BNBUSD** vol≈**0.16** (−$9.48) — same thin-volume stop as prior vol-floor research
- ETHUSD vol≈1.42 (−$9.95), LINKUSD vol≈0.88 (−$11.21) — not volume-gated
- Only one non-stop trade with vol&lt;0.30 (LINK trailing +$0.56)

## Vol-floor probe (promote stack, static weights)

| id | 90/45 earlier | 90/45 OOS | 60/60 earlier | 60/60 OOS | dual |
|---|---|---|---|---|---|
| paper_live | n=16 PF3.17 +$37.50 | n=10 PF2.48 +$15.80 | n=11 PF2.57 +$20.14 | n=16 PF2.89 +$30.42 | **PASS** |
| vol_030 / 0.25 | n=14 PF6.97 +$46.41 | same OOS | n=**9** PF4.16 +$24.64 | same OOS | **fail (n)** |
| **vol_020** | n=15 PF**7.04** +$46.98 | same OOS | n=**10** PF**4.23** +$25.20 | same OOS | **PASS** |

vol≥0.20 cuts the BNB stop, lifts earlier PF/net, keeps earlier60 n≥10. Tighter floors starve 60/60 earlier n.

## Paper wiring
- `V2_CONFIG.MIN_SIGNAL_VOLUME_RATIO = 0.20`
- Enforced in live `generateSignals` (TREND). MOMENTUM already has its own `VOLUME_MULTIPLIER` (1.3–1.5).
- Research `entryFilters.minVolumeRatio` unchanged API.

## Decision
**Promote** vol floor 0.20. Stats baseline reset on restart. Rollback: remove gate / set undefined if soak n collapses without quality gain.
