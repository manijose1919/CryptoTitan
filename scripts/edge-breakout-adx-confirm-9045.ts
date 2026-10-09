#!/usr/bin/env node
/**
 * BREAKOUT under paper ADX≥20 + optional confirm (research only).
 *
 * Paper strategyRunner now ADX-gates BREAKOUT; tradeEngine does NOT confirm
 * BREAKOUT (TREND/MOMENTUM only). Family bake-off (2026-09-22) failed without
 * ADX/confirm parity. Re-baseline under fee-aware 90/45.
 *
 * Protocol: CAD10 4h 0.52% RT 5bps next-bar; bar OOS PF>1.1 & net>0 & earlier PF≥0.9 & n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-breakout-adx-confirm-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS, STRATEGY_EXIT_CONFIGS } from '../v2/engine/config.ts';
import { adx } from '../v2/indicators/indicators.ts';
import { detectBreakoutEntry } from '../v2/pipeline/breakoutSignal.ts';
import { passesConfirmBar, passesEntryBarQuality } from '../v2/backtest/backtestEngine.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';
import type { Candle } from '../v2/pipeline/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;
const FEE_RT = V2_CONFIG.FEE_ROUND_TRIP_TAKER;
const SLIP = V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE;

type Ablation = {
  id: string;
  label: string;
  regimes: readonly string[];
  confirm: boolean;
  chase: number | null;
  requireAdx: boolean;
};

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live_breakout',
    label: 'Paper-ish: ADX20, no confirm, chase off, SU+UP',
    regimes: ['STRONG_UP', 'UP'],
    confirm: false,
    chase: null,
    requireAdx: true,
  },
  {
    id: 'su_only_adx',
    label: 'STRONG_UP only + ADX20, no confirm',
    regimes: ['STRONG_UP'],
    confirm: false,
    chase: null,
    requireAdx: true,
  },
  {
    id: 'su_adx_confirm',
    label: 'STRONG_UP + ADX20 + bullish_close confirm',
    regimes: ['STRONG_UP'],
    confirm: true,
    chase: null,
    requireAdx: true,
  },
  {
    id: 'su_adx_confirm_chase',
    label: 'STRONG_UP + ADX20 + confirm + chase≤0.80',
    regimes: ['STRONG_UP'],
    confirm: true,
    chase: 0.8,
    requireAdx: true,
  },
  {
    id: 'su_up_adx_confirm_chase',
    label: 'SU+UP + ADX20 + confirm + chase≤0.80',
    regimes: ['STRONG_UP', 'UP'],
    confirm: true,
    chase: 0.8,
    requireAdx: true,
  },
  {
    id: 'no_adx_su_up',
    label: 'SU+UP, no ADX (pre-parity control)',
    regimes: ['STRONG_UP', 'UP'],
    confirm: false,
    chase: null,
    requireAdx: false,
  },
];

type Trade = { pnlNet: number; win: boolean };

function applySlip(price: number, side: 'entry' | 'exit'): number {
  return side === 'entry' ? price * (1 + SLIP) : price * (1 - SLIP);
}

function simulateTrade(
  candles: Candle[],
  entryBar: number,
  atrPct: number,
): Trade | null {
  if (entryBar >= candles.length) return null;
  const entryPx = applySlip(candles[entryBar]!.open, 'entry');
  const exitCfg = STRATEGY_EXIT_CONFIGS.BREAKOUT;
  const atrFrac = atrPct / 100;
  const stop = entryPx * (1 - atrFrac * exitCfg.slAtrMult);
  const tp = entryPx * (1 + atrFrac * exitCfg.tpAtrMult);
  const maxBar = Math.min(candles.length - 1, entryBar + exitCfg.timeKillBars);
  let peak = entryPx;
  let trailArmed = false;
  let exitPx = candles[maxBar]!.close;
  for (let i = entryBar; i <= maxBar; i++) {
    const c = candles[i]!;
    if (c.low <= stop) {
      exitPx = Math.min(c.open, stop); // gap-aware pessimistic
      break;
    }
    if (c.high >= tp) {
      exitPx = tp;
      break;
    }
    peak = Math.max(peak, c.high);
    if (!trailArmed && (peak - entryPx) / entryPx >= exitCfg.trailActivatePercent) {
      trailArmed = true;
    }
    if (trailArmed) {
      const trail = peak * (1 - exitCfg.trailGivebackPercent);
      if (c.low <= trail) {
        exitPx = Math.min(c.open, trail);
        break;
      }
    }
    if (i === maxBar) exitPx = c.close;
  }
  exitPx = applySlip(exitPx, 'exit');
  const gross = (exitPx - entryPx) / entryPx;
  const pnlNet = (gross - FEE_RT) * 100; // $ on $100 notional unit
  return { pnlNet, win: pnlNet > 0 };
}

function summarize(trades: Trade[]) {
  const n = trades.length;
  if (n === 0) return { trades: 0, winRate: 0, net: 0, pf: null as number | null };
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const grossWin = wins.reduce((s, t) => s + t.pnlNet, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlNet, 0));
  const net = trades.reduce((s, t) => s + t.pnlNet, 0);
  const pf = grossLoss === 0 ? null : Number((grossWin / grossLoss).toFixed(3));
  return {
    trades: n,
    winRate: Number((wins.length / n).toFixed(4)),
    net: Number(net.toFixed(2)),
    pf,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const trades: Trade[] = [];

  for (const [ticker, candles] of allCandles) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length - 2; bar++) {
      const window = candles.slice(0, bar + 1);
      if (ab.requireAdx && (window.length < 30 || adx(window) < MIN_ADX)) continue;

      const sig = detectBreakoutEntry(window, ticker);
      if (!sig || !sig.passed) continue;
      if (!ab.regimes.includes(sig.regime)) continue;

      const signalBar = window[window.length - 1]!;
      const atrPct = sig.signals.atr_percent as number;
      const atrVal = sig.signals.atr as number;

      if (ab.chase != null) {
        if (!passesEntryBarQuality(signalBar, atrVal, { maxSignalCloseLocation: ab.chase }, 'long').ok) {
          continue;
        }
      }

      let entryBar = bar + 1; // next-bar open default
      if (ab.confirm) {
        const confirmBar = candles[bar + 1]!;
        if (!passesConfirmBar(signalBar, confirmBar, 'bullish_close', 'long').ok) continue;
        entryBar = bar + 2;
      }
      if (entryBar >= candles.length) continue;

      const t = simulateTrade(candles, entryBar, atrPct);
      if (t) trades.push(t);
    }
  }

  const summary = summarize(trades);
  console.log(`    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`);
  return summary;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BREAKOUT ADX + confirm re-baseline (90/45 fee-aware)  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier90 = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos45 = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    rows.push({
      id: ab.id,
      label: ab.label,
      earlier90,
      oos45,
      meetsPromotionBar: meetsBar(oos45, earlier90),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'BREAKOUT with paper ADX≥20 (± confirm/chase) may clear fee-aware 90/45 where the 2026-09-22 family bake-off failed without ADX parity.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fees: '0.52% RT + 5bps/side next-bar',
      note: 'Lightweight breakout simulator (not full backtestEngine); research only.',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-breakout-adx-confirm-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-breakout-adx-confirm-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-breakout-adx-confirm-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.meetsPromotionBar ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
