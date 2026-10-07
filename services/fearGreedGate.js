/**
 * Fear & Greed Gate — Blended macro sentiment filter.
 *
 * Combines subjective crowd sentiment (Alternative.me F&G) with objective
 * on-chain data (funding rates, exchange flows, liquidation cascades) to
 * produce a more accurate fear/greed reading.
 *
 * Blended Score Weights:
 *   40% Alternative.me F&G Index (crowd sentiment — what people SAY)
 *   30% Funding rate signal (what traders are actually DOING with leverage)
 *   20% Exchange flow signal (are people pulling coins off exchanges?)
 *   10% Liquidation cascade signal (post-cascade = opportunity)
 *
 * Extreme Fear (<25) → increase size (contrarian buys)
 * Neutral (25-75)    → normal sizing
 * Extreme Greed (>75) → reduce size / block entries
 */

import fetch from 'node-fetch';

// ─── Config ─────────────────────────────────────────────────

const FETCH_INTERVAL_MS = 30 * 60 * 1000; // Refresh Alternative.me every 30 min
const API_URL = 'https://api.alternative.me/fng/?limit=2';

const WEIGHTS = {
  alternativeMe: 0.40,
  fundingRate:   0.30,
  exchangeFlow:  0.20,
  liquidation:   0.10,
};

// ─── State ──────────────────────────────────────────────────

let alternativeMeIndex = 50;     // Raw Alternative.me value (0-100)
let alternativeMeClassification = 'Neutral';
let previousAlternativeMeIndex = 50;
let alternativeMeTrend = 0;
let lastFetchTime = 0;

// Blended values (what consumers see)
let currentIndex = 50;
let currentClassification = 'Neutral';
let indexTrend = 0;
let previousBlendedIndex = 50;

// On-chain module references (lazy-loaded)
let _derivativesModule = null;
let _whaleFlowModule = null;
let _liquidationModule = null;
let _modulesLoaded = false;

// Source breakdown for dashboard transparency
let sourceBreakdown = {
  alternativeMe: { value: 50, weight: WEIGHTS.alternativeMe, raw: 50 },
  fundingRate:   { value: 50, weight: WEIGHTS.fundingRate, raw: 0, detail: 'not loaded' },
  exchangeFlow:  { value: 50, weight: WEIGHTS.exchangeFlow, raw: 0, detail: 'not loaded' },
  liquidation:   { value: 50, weight: WEIGHTS.liquidation, raw: false, detail: 'not loaded' },
};

// ─── Lazy-load on-chain modules ─────────────────────────────

async function loadOnChainModules() {
  if (_modulesLoaded) return;
  _modulesLoaded = true;

  try {
    _derivativesModule = await import('./derivativesIntelligence.js');
    console.log('[FearGreedGate] Derivatives intelligence loaded');
  } catch { console.warn('[FearGreedGate] Derivatives intelligence not available'); }

  try {
    _whaleFlowModule = await import('./whaleFlowTracker.js');
    console.log('[FearGreedGate] Whale flow tracker loaded');
  } catch { console.warn('[FearGreedGate] Whale flow tracker not available'); }

  try {
    _liquidationModule = await import('./liquidationSweepDetector.js');
    console.log('[FearGreedGate] Liquidation sweep detector loaded');
  } catch { console.warn('[FearGreedGate] Liquidation sweep detector not available'); }
}

// ─── On-chain signal conversion (raw → 0-100 F&G scale) ────

/**
 * Convert funding rate to a 0-100 fear/greed score.
 * High positive funding = greed (longs paying shorts, overcrowded)
 * Negative funding = fear (shorts paying longs, bearish consensus)
 * Near-zero = neutral
 */
function fundingRateToScore() {
  try {
    const getAllData = _derivativesModule?.getAllDerivativesData || _derivativesModule?.default?.getAllDerivativesData;
    if (!getAllData) return 50;

    const allData = getAllData();
    const tickers = Object.values(allData || {});
    if (tickers.length === 0) return 50;

    // Average annualized funding across tracked tickers
    const fundingValues = tickers.filter(t => t.fundingRateAnnualized != null);
    if (fundingValues.length === 0) return 50;

    const avgFunding = fundingValues.reduce((sum, t) => sum + t.fundingRateAnnualized, 0) / fundingValues.length;

    // Map: -50% annualized → score 10 (extreme fear)
    //       0% annualized  → score 50 (neutral)
    //      +50% annualized → score 90 (extreme greed)
    const score = Math.max(0, Math.min(100, 50 + avgFunding));

    sourceBreakdown.fundingRate = {
      value: Math.round(score),
      weight: WEIGHTS.fundingRate,
      raw: avgFunding,
      detail: `${avgFunding > 0 ? '+' : ''}${avgFunding.toFixed(1)}% avg annualized funding`,
    };

    return score;
  } catch {
    return 50;
  }
}

/**
 * Convert exchange flow to a 0-100 fear/greed score.
 * Net outflow (coins leaving exchanges) = bullish (people holding, not selling)
 * Net inflow (coins entering exchanges) = bearish (preparing to sell)
 */
function exchangeFlowToScore() {
  try {
    const getSignal = _whaleFlowModule?.getWhaleFlowSignal || _whaleFlowModule?.default?.getWhaleFlowSignal;
    if (!getSignal) return 50;

    const btcFlow = getSignal('BTCUSD');
    if (!btcFlow || btcFlow.direction === 'NEUTRAL') return 50;

    // BULLISH (outflow, coins leaving exchanges) → higher score (confidence)
    // BEARISH (inflow, coins entering exchanges) → lower score (fear)
    let score = 50;
    if (btcFlow.direction === 'BULLISH') {
      score = 50 + Math.min(40, btcFlow.strength * 0.4); // Max 90
    } else if (btcFlow.direction === 'BEARISH') {
      score = 50 - Math.min(40, btcFlow.strength * 0.4); // Min 10
    }

    sourceBreakdown.exchangeFlow = {
      value: Math.round(score),
      weight: WEIGHTS.exchangeFlow,
      raw: btcFlow.netFlow || 0,
      detail: `${btcFlow.direction} strength=${btcFlow.strength}, trend=${btcFlow.trend}`,
    };

    return score;
  } catch {
    return 50;
  }
}

/**
 * Convert liquidation cascade status to a 0-100 fear/greed score.
 * Active cascade = extreme fear (score 5)
 * Post-cascade recovery = contrarian opportunity (score 20 — still fearful but recovering)
 * No cascade = neutral (score 50)
 */
function liquidationToScore() {
  try {
    const getStatus = _liquidationModule?.getSweepStatus || _liquidationModule?.default?.getSweepStatus;
    if (!getStatus) return 50;

    const status = getStatus();
    if (!status?.events) return 50;

    const recentEvents = status.events.filter(e => Date.now() - e.timestamp < 4 * 60 * 60 * 1000);

    if (recentEvents.length === 0) {
      sourceBreakdown.liquidation = {
        value: 50, weight: WEIGHTS.liquidation, raw: false, detail: 'No recent cascades',
      };
      return 50;
    }

    // Recent cascade detected — this is extreme fear but also opportunity
    const mostRecent = recentEvents[recentEvents.length - 1];
    const ageMs = Date.now() - mostRecent.timestamp;
    const ageMinutes = ageMs / 60000;

    let score;
    if (ageMinutes < 30) {
      score = 5; // Active cascade — extreme fear
    } else if (ageMinutes < 120) {
      score = 15; // Post-cascade — still fear, but stabilizing
    } else {
      score = 30; // Recovery phase — fear fading
    }

    sourceBreakdown.liquidation = {
      value: score,
      weight: WEIGHTS.liquidation,
      raw: true,
      detail: `Cascade ${ageMinutes.toFixed(0)}min ago (${recentEvents.length} events in 4h)`,
    };

    return score;
  } catch {
    return 50;
  }
}

// ─── Blending ───────────────────────────────────────────────

function computeBlendedIndex() {
  const altMe = alternativeMeIndex;
  const funding = fundingRateToScore();
  const flow = exchangeFlowToScore();
  const liq = liquidationToScore();

  sourceBreakdown.alternativeMe = {
    value: altMe,
    weight: WEIGHTS.alternativeMe,
    raw: altMe,
    detail: alternativeMeClassification,
  };

  const blended = Math.round(
    altMe * WEIGHTS.alternativeMe +
    funding * WEIGHTS.fundingRate +
    flow * WEIGHTS.exchangeFlow +
    liq * WEIGHTS.liquidation
  );

  previousBlendedIndex = currentIndex;
  currentIndex = Math.max(0, Math.min(100, blended));
  indexTrend = currentIndex - previousBlendedIndex;

  // Classify the blended score
  if (currentIndex <= 10) currentClassification = 'Extreme Fear';
  else if (currentIndex <= 25) currentClassification = 'Fear';
  else if (currentIndex <= 40) currentClassification = 'Mild Fear';
  else if (currentIndex <= 60) currentClassification = 'Neutral';
  else if (currentIndex <= 75) currentClassification = 'Mild Greed';
  else if (currentIndex <= 90) currentClassification = 'Greed';
  else currentClassification = 'Extreme Greed';
}

// ─── Fetch Alternative.me ───────────────────────────────────

async function fetchFearGreedIndex() {
  try {
    const resp = await fetch(API_URL, { timeout: 5000 });
    if (!resp.ok) return;
    const data = await resp.json();

    if (data?.data?.[0]) {
      previousAlternativeMeIndex = alternativeMeIndex;
      alternativeMeIndex = Math.max(0, Math.min(100, parseInt(data.data[0].value) || 50));
      alternativeMeClassification = data.data[0].value_classification;
      alternativeMeTrend = alternativeMeIndex - previousAlternativeMeIndex;
      lastFetchTime = Date.now();

      if (data.data[1]) {
        const yesterday = parseInt(data.data[1].value);
        alternativeMeTrend = alternativeMeIndex - yesterday;
      }
    }
  } catch (err) {
    console.warn('[FearGreedGate] Alternative.me fetch failed:', err.message);
  }

  // Recompute blended score with fresh Alternative.me + current on-chain data
  computeBlendedIndex();

  console.log(
    `[FearGreedGate] Blended: ${currentIndex} (${currentClassification}) | ` +
    `Alt.me: ${alternativeMeIndex} (${alternativeMeClassification}), ` +
    `Funding: ${sourceBreakdown.fundingRate.value}, ` +
    `Flow: ${sourceBreakdown.exchangeFlow.value}, ` +
    `Liq: ${sourceBreakdown.liquidation.value}`
  );
}

// ─── Public API (same interface as before) ──────────────────

let _initialized = false;
/**
 * Wall-clock staleness check. setInterval alone drifts across VM suspend
 * (same class as the trading loop watchdog — 2026-10-07 soak).
 */
export function isFearGreedFetchStale(now = Date.now(), maxAgeMs = FETCH_INTERVAL_MS) {
  if (!lastFetchTime) return true;
  return now - lastFetchTime > maxAgeMs;
}

/** Refresh Alt.me when wall-clock age exceeds the fetch interval. */
export async function refreshFearGreedIfStale(now = Date.now(), maxAgeMs = FETCH_INTERVAL_MS) {
  if (!isFearGreedFetchStale(now, maxAgeMs)) return false;
  await fetchFearGreedIndex();
  return true;
}

export async function initFearGreedGate() {
  if (_initialized) return; // Prevent duplicate intervals on re-init
  _initialized = true;
  await loadOnChainModules();
  await fetchFearGreedIndex();
  setInterval(fetchFearGreedIndex, FETCH_INTERVAL_MS);
  // Also recompute blended score every 5 min (on-chain data updates more often)
  setInterval(computeBlendedIndex, 5 * 60 * 1000);
  // Recompute after 30s — by then derivatives/whale-flow pollers should have data from their first fetch
  setTimeout(computeBlendedIndex, 30_000);
  console.log('[FearGreedGate] Initialized — blended mode (Alt.me 40% + Funding 30% + Flow 20% + Liq 10%)');
}

/**
 * Position size multiplier based on blended Fear & Greed.
 */
export function getPositionMultiplier() {
  if (currentIndex <= 10) return 1.8;
  if (currentIndex <= 25) return 1.5;
  if (currentIndex <= 40) return 1.2;
  if (currentIndex <= 60) return 1.0;
  if (currentIndex <= 75) return 0.8;
  if (currentIndex <= 90) return 0.5;
  return 0.3;
}

/**
 * Block new long entries during extreme greed.
 */
export function shouldBlockEntry() {
  if (currentIndex > 85 && indexTrend > 0) {
    return {
      block: true,
      reason: `Extreme Greed (blended): ${currentIndex} (${currentClassification}), trending up +${indexTrend}`,
    };
  }
  return { block: false, reason: '' };
}

/**
 * Get current status including source breakdown for dashboard.
 */
export function getFearGreedStatus() {
  // Kick a wall-clock refresh after suspend without blocking health handlers.
  if (isFearGreedFetchStale()) {
    void refreshFearGreedIfStale();
  }
  return {
    index: currentIndex,
    classification: currentClassification,
    trend: indexTrend,
    positionMultiplier: getPositionMultiplier(),
    isBlocking: shouldBlockEntry().block,
    lastFetchTime,
    nextFetch: lastFetchTime + FETCH_INTERVAL_MS,
    blended: true,
    sources: sourceBreakdown,
    alternativeMeRaw: alternativeMeIndex,
  };
}

/**
 * Get the blended index value (0-100).
 */
export function getFearGreedIndex() {
  return currentIndex;
}

/**
 * Get just the raw Alternative.me value (for comparison/logging).
 */
export function getAlternativeMeRaw() {
  return alternativeMeIndex;
}

export default {
  initFearGreedGate,
  isFearGreedFetchStale,
  refreshFearGreedIfStale,
  getPositionMultiplier,
  shouldBlockEntry,
  getFearGreedStatus,
  getFearGreedIndex,
  getAlternativeMeRaw,
};
