# 2026-10-10 — Locked-stack baseline refresh (calendar roll)

## Stack
`STRONG_UP + bullish_close confirm + chase≤0.80 + MAX_ATR=2.5 + minATR≥1.5 + ADX≥20 + confirmMomentum`
CAD10, 4h, pessimistic bar sequence, fee RT + paper slippage.

## Script
`scripts/edge-locked-stack-baseline-9045.ts` → `/opt/cursor/artifacts/edge-locked-stack-baseline-9045.json`

## Results (end = 2026-10-10 UTC midnight)

### Pre MOMENTUM scan-parity fix (optimistic OOS)
| Split | Window | n | WR | net | PF | Pass |
|-------|--------|---|----|-----|----|------|
| 90/45 earlier | 90d → −45d | 6 | 0.33 | −$10.94 | 0.455 | no |
| 90/45 OOS | last 45d | 6 | 0.83 | +$17.13 | 4.496 | — |
| 60/60 earlier | 60d → −60d | 3 | 0.67 | +$3.73 | 1.692 | no |
| 60/60 OOS | last 60d | 11 | 0.91 | +$28.62 | 6.792 | — |

### Post fix (honest; see `2026-10-10-momentum-scan-parity.md`)
| Split | n | net | PF | Pass |
|-------|---|-----|----|------|
| 90/45 earlier | 6 | −$10.94 | 0.455 | no |
| 90/45 OOS | **4** | **+$5.00** | **2.02** | — |
| 60/60 earlier | 3 | +$3.73 | 1.692 | no |
| 60/60 OOS | **9** | **+$16.48** | **4.336** | — |

Promotion bar (OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10): **fail both splits**.

## Read
- After scan parity, OOS is still PF-positive but smaller (DOT/ADA over-ATR MOMENTUM removed).
- Earlier half is still the gate: 90/45 earlier is PF-negative (stop_loss −$9.48 + time_kill −$5.18); 60/60 earlier clears PF but **n=3**.
- Regime scarcity refresh: earlier60 SU+ADX+ATR **120** vs oos60 **307** (~2.6×) — structural n ceiling unchanged.

## Soak context
- `:3137` paper: open 0, risk-off HTF (no STRONG_UP), shorts off / DCA sim.
- Post-suspend WS + watchdog path validated earlier this cycle; status now exposes `loopInProgress` / `loopStartedAt` for monitors.

## Decision
No trading-config change. Do not promote. Keep locked stack; next profitability work must raise **earlier n** without casual risk loosening (or wait for regime supply).
