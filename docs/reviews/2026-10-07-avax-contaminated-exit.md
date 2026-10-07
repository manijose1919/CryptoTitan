# 2026-10-07 — Contaminated AVAX MOMENTUM exit

## Trade
| Field | Value |
|---|---|
| id | `f69f31c0-ae44-4c4f-b7c2-901bb279b35a` |
| ticker / strategy | AVAXUSD / MOMENTUM / 4h |
| entry | 2026-10-06 12:14:52 UTC @ $11.6708 |
| exit | 2026-10-07 12:07:03 UTC @ $11.0045 |
| pnl_net | **−$12.99** |
| exit_reason | trailing |
| contamination | Entered while TREND ADX-blocked (ADX 15.2); skipped confirm |

## Cohort handling
- Listed in `CONTAMINATED_TRADE_IDS` (`v2/dashboard/cohortScope.ts`).
- Headline monitor cohort = main pipeline (TREND/MOMENTUM/BREAKOUT) **minus** contaminated IDs → still tradeCount 0.
- `recentClosed` still shows the row for soak forensics.
- Portfolio cash reflects the loss (−$64.72 all-time closed net); do not use for promote evidence.

## Follow-up
Gates that would have blocked this fill are now live (ADX + MOMENTUM confirm). No baseline reset.
