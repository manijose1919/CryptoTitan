#!/usr/bin/env node
/**
 * Fee-aware STRONG_DOWN short probe (research only — do NOT enable SHORTS_ENABLED).
 *
 * Mirrors strategyRunner short path: scan side=short, ADX≥20, generateShortSignals,
 * bearish confirm T+1 → entry T+2, chase≤0.85, ATR 1.5–2.8, ADX=TREND_MIN(15), CAD fees.
 *
 * Protocol: 90/45 CAD10 4h. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 * 2026-07 review found recent STRONG_DOWN shorts net-negative; re-check under confirm parity.
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

async function runWindow(label: string, days: number, end: Date): Promise<WindowSummary> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
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
      if (!passesSignalAtrBand(atrPercent, { minSignalAtrPercent: 1.5, maxSignalAtrPercent: 2.8 }).ok) {
        continue;
      }
      const signalBar = window[window.length - 1]!;
      if (!passesEntryBarQuality(signalBar, atrValue, { maxSignalCloseLocation: 0.85 }, 'short').ok) {
        continue;
      }

      const confirmBar = candles[bar + 1]!;
      const entryBarCandle = candles[bar + 2]!;
      if (!passesConfirmBar(signalBar, confirmBar, 'bearish_close', 'short').ok) continue;

      const entryPrice = getNextBarEntryPrice(candles, bar + 1, 'short', SLIP);
      if (entryPrice == null) continue;

      const stopLoss = entryPrice + atrValue * V2_CONFIG.SHORT_STOP_LOSS_ATR_MULT;
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

  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier90 = await runWindow('earlier90', 90, end45);
  const oos45 = await runWindow('oos45', 45, end);
  const earlier60 = await runWindow('earlier60', 60, end60);
  const oos60 = await runWindow('oos60', 60, end);
  const pass9045 = meetsBar(oos45, earlier90);
  const pass6060 = meetsBar(oos60, earlier60);
  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'STRONG_DOWN short refresh under ADX15 + ATR1.5-2.8 + chase0.85 — research only',
    shortsEnabledInPaper: V2_CONFIG.SHORTS_ENABLED,
    signalWeightMode: 'static',
    minAdx: MIN_ADX,
    atrBand: [1.5, 2.8],
    chase: 0.85,
    earlier90,
    oos45,
    earlier60,
    oos60,
    pass9045,
    pass6060,
    dualPass: pass9045 && pass6060,
  };
  writeFileSync('/opt/cursor/artifacts/edge-short-refresh-adx15-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-short-refresh-adx15-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/tmp/cryptotitan-artifacts/edge-short-refresh-adx15-9045.json', JSON.stringify(out, null, 2));
  console.log('\npass9045=', pass9045, 'pass6060=', pass6060, 'dualPass=', pass9045 && pass6060);
  console.log(JSON.stringify({ earlier90, oos45, earlier60, oos60 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
