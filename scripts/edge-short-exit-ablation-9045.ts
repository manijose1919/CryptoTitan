#!/usr/bin/env node
/**
 * Short exit ablations under STRONG_DOWN+confirm stack (research only).
 * Prior probe: earlier PF 1.30 n=20 but OOS PF 0.72 on stop_loss drag.
 * Ask: does tighter SHORT_STOP_LOSS_ATR_MULT clear OOS without destroying earlier?
 *
 * Do NOT enable SHORTS_ENABLED. Protocol: 90/45 CAD10 4h fee-aware.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { scanMarket } from '../v2/pipeline/marketScanner.ts';
import { generateShortSignals, setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import {
  checkExitOnBar,
  passesConfirmBar,
  passesEntryBarQuality,
  passesSignalAtrBand,
} from '../v2/backtest/backtestEngine.ts';
import { getNextBarEntryPrice } from '../v2/backtest/backtestExecution.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';
import type { BacktestConfig, BacktestTrade } from '../v2/backtest/types.ts';
import { applyPaperSlippage } from '../v2/engine/tradeAccounting.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;
const FEE_RT = V2_CONFIG.SHORT_FEE_ROUND_TRIP;
const SLIP = V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE;

type WindowSummary = {
  trades: number;
  winRate: number;
  net: number;
  pf: number | null;
  byExit: Record<string, { n: number; pnl: number }>;
};

function summarize(trades: BacktestTrade[]): WindowSummary {
  const closed = trades.filter((t) => t.pnlNet != null);
  const wins = closed.filter((t) => (t.pnlNet ?? 0) > 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnlNet ?? 0), 0);
  const grossLoss = Math.abs(
    closed.filter((t) => (t.pnlNet ?? 0) < 0).reduce((s, t) => s + (t.pnlNet ?? 0), 0),
  );
  const byExit: Record<string, { n: number; pnl: number }> = {};
  for (const t of closed) {
    const k = String(t.exitReason);
    if (!byExit[k]) byExit[k] = { n: 0, pnl: 0 };
    byExit[k].n++;
    byExit[k].pnl += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byExit)) v.pnl = Number(v.pnl.toFixed(2));
  const net = closed.reduce((s, t) => s + (t.pnlNet ?? 0), 0);
  return {
    trades: closed.length,
    winRate: closed.length ? Number((wins.length / closed.length).toFixed(4)) : 0,
    net: Number(net.toFixed(2)),
    pf: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : closed.length ? null : null,
    byExit,
  };
}

function meetsBar(oos: WindowSummary, earlier: WindowSummary): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function runWindow(
  label: string,
  days: number,
  end: Date,
  slMult: number,
): Promise<WindowSummary> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(
    `\n>>> ${label} sl=${slMult} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`,
  );
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const trades: BacktestTrade[] = [];
  let tradeSeq = 0;

  const btConfig: BacktestConfig = {
    startDate,
    endDate: end,
    tickers: CAD10,
    budgetPerTicker: 1000,
    interval: '4h',
    intervalMinutes: 240,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: FEE_RT,
    slippagePerSide: SLIP,
    barSequence: 'pessimistic',
    seed: false,
  };

  for (const [ticker, candles] of allCandles) {
    let cash = 1000;
    let open: BacktestTrade | null = null;
    let lastExitBar = -999;

    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length; bar++) {
      const current = candles[bar]!;

      // --- exits ---
      if (open) {
        const exit = checkExitOnBar(open, current, bar, btConfig);
        open.currentStop = exit.newStop;
        open.trailingActivated = exit.trailingActivated;
        open.holdBars = bar - open.entryBar;
        if (exit.shouldExit && exit.exitPrice != null) {
          const fill = applyPaperSlippage(exit.exitPrice, 'short', 'exit', SLIP);
          const pnlGross = (open.entryPrice - fill) * open.quantity;
          const fees = open.positionSizeUsd * FEE_RT;
          const pnlNet = pnlGross - fees;
          open.exitBar = bar;
          open.exitPrice = fill;
          open.exitTime = current.time;
          open.exitReason = exit.exitReason;
          open.pnlGross = pnlGross;
          open.pnlNet = pnlNet;
          open.feesPaid = fees;
          cash += open.positionSizeUsd + pnlNet;
          trades.push(open);
          open = null;
          lastExitBar = bar;
          continue;
        }
      }

      if (open) continue;
      if (bar - lastExitBar < 2) continue;
      if (bar + 2 >= candles.length) continue;

      const window = candles.slice(0, bar + 1);
      const tickerCandles = new Map([[ticker, window]]);
      const scan = scanMarket(tickerCandles, 'short');
      const passed = scan.find((s) => s.ticker === ticker && s.passed);
      if (!passed) continue;
      if (window.length < 30 || adx(window) < MIN_ADX) continue;

      const shorts = generateShortSignals([passed], tickerCandles);
      const sig = shorts.find((s) => s.passed);
      if (!sig) continue;

      const { signals } = computeSignals(window);
      const atrPercent = signals.atr_percent as number;
      const atrValue = signals.atr as number;
      if (!passesSignalAtrBand(atrPercent, { minSignalAtrPercent: 1.5, maxSignalAtrPercent: 2.5 }).ok) {
        continue;
      }
      const signalBar = window[window.length - 1]!;
      if (!passesEntryBarQuality(signalBar, atrValue, { maxSignalCloseLocation: 0.8 }, 'short').ok) {
        continue;
      }

      const confirmBar = candles[bar + 1]!;
      const entryBarCandle = candles[bar + 2]!;
      if (!passesConfirmBar(signalBar, confirmBar, 'bearish_close', 'short').ok) continue;

      const entryPrice = getNextBarEntryPrice(candles, bar + 1, 'short', SLIP);
      if (entryPrice == null) continue;

      const stopLoss = entryPrice + atrValue * slMult;
      const takeProfit = entryPrice - atrValue * V2_CONFIG.SHORT_TAKE_PROFIT_ATR_MULT;
      let positionSizeUsd = cash * V2_CONFIG.BASE_POSITION_PERCENT * sig.confidence;
      const stopDistPct = Math.abs(entryPrice - stopLoss) / entryPrice;
      if (stopDistPct > 0 && V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT > 0) {
        const maxRiskUsd = 1000 * V2_CONFIG.MAX_RISK_PER_TRADE_PERCENT;
        const riskCap = maxRiskUsd / stopDistPct;
        if (positionSizeUsd > riskCap) positionSizeUsd = riskCap;
      }
      if (positionSizeUsd < 10 || positionSizeUsd > cash) continue;

      const quantity = entryPrice > 0 ? positionSizeUsd / entryPrice : 0;
      cash -= positionSizeUsd;
      tradeSeq++;
      open = {
        id: `sh_${ticker}_${tradeSeq}`,
        ticker,
        side: 'short',
        entryBar: bar + 2,
        entryPrice,
        entryTime: entryBarCandle.time,
        entrySignals: signals,
        entryRegime: sig.regime,
        entryConfidence: sig.confidence,
        compositeScore: sig.compositeScore,
        exitBar: null,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        quantity,
        positionSizeUsd,
        stopLoss,
        takeProfit,
        currentStop: stopLoss,
        trailingActivated: false,
        peakPrice: entryPrice,
        pnlGross: null,
        pnlNet: null,
        feesPaid: 0,
        holdBars: 0,
        holdDurationMs: null,
        atrPercent,
      };
      bar += 1; // skip confirm bar processing once reserved
    }
  }

  const out = summarize(trades);
  console.log(
    `  n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf} byExit=${JSON.stringify(out.byExit)}`,
  );
  return out;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  const slLevels = [1.5, 1.2, 1.0];
  const rows = [];
  for (const sl of slLevels) {
    console.log(`\n=== SHORT SL ATR mult=${sl} ===`);
    const earlier90 = await runWindow('earlier90', 90, end45, sl);
    const oos45 = await runWindow('oos45', 45, end, sl);
    rows.push({
      slAtrMult: sl,
      earlier90,
      oos45,
      pass9045: meetsBar(oos45, earlier90),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Tighten short SL under STRONG_DOWN+confirm — research only',
    shortsEnabledInPaper: V2_CONFIG.SHORTS_ENABLED,
    signalWeightMode: 'static',
    anyPromote: rows.some((r) => r.pass9045),
    rows,
  };
  writeFileSync('/opt/cursor/artifacts/edge-short-exit-ablation-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-short-exit-ablation-9045.json', JSON.stringify(out, null, 2));
  console.log('\nanyPromote=', out.anyPromote);
  for (const r of rows) {
    console.log(
      `${r.pass9045 ? 'PASS' : 'fail'} sl=${r.slAtrMult} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} net=${r.earlier90.net} | oos n=${r.oos45.trades} PF=${r.oos45.pf} net=${r.oos45.net}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
