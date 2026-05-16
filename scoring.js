'use strict';

// ═══════════════════════════════════════════════════════════════
// SCORING ENGINE
// Pure JS — no DOM dependencies. Loaded before app.js.
// ═══════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Factor definitions
// ---------------------------------------------------------------------------

const VALUE_FACTORS = [
  { key: 'pe',    label: 'P/E Ratio' },
  { key: 'pb',    label: 'P/B Ratio' },
  { key: 'ps',    label: 'P/S Ratio' },
  { key: 'pcf',   label: 'P/CF Ratio' },
  { key: 'yield', label: 'Dividend Yield' },
];

const GROWTH_FACTORS = [
  { key: 'eps_fwd',  label: 'EPS Fwd Growth' },
  { key: 'eps_hist', label: 'EPS Hist Growth' },
  { key: 'rev',      label: 'Revenue Growth' },
  { key: 'cf',       label: 'CF Growth' },
  { key: 'bv',       label: 'Book Value Growth' },
];

// ---------------------------------------------------------------------------
// Size thresholds (market cap in USD)
// ---------------------------------------------------------------------------

const SIZE_THRESHOLDS = {
  large: 10e9,  // > $10B
  mid:   2e9,   // $2B – $10B
  // small: < $2B
};

function getSize(marketCap) {
  if (!marketCap) return 'unknown';
  if (marketCap >= SIZE_THRESHOLDS.large) return 'large';
  if (marketCap >= SIZE_THRESHOLDS.mid)   return 'mid';
  return 'small';
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

// Unwrap Yahoo Finance { raw, fmt } objects
function raw(v) {
  return v?.raw ?? v;
}

// Lower raw value → higher score (value multiples: PE, PB, etc.)
// steps: [[upperBound, score], ...] ascending bounds, returns score for first bound exceeded
function scoreValueFactor(val, steps) {
  for (const [bound, score] of steps) {
    if (val < bound) return score;
  }
  return steps[steps.length - 1][1];
}

// Higher raw value → higher score (growth rates, dividend yield)
// steps: [[lowerBound, score], ...] descending bounds (highest first)
function scoreGrowthFactor(val, steps) {
  for (const [bound, score] of steps) {
    if (val >= bound) return score;
  }
  return 5;
}

// ---------------------------------------------------------------------------
// Factor threshold tables
// ---------------------------------------------------------------------------

const VALUE_STEPS = {
  pe:  [[10, 95], [15, 75], [25, 50], [40, 25], [Infinity, 5]],
  pb:  [[1, 95],  [2, 75],  [4, 50],  [7, 25],  [Infinity, 5]],
  ps:  [[1, 95],  [2, 75],  [5, 50],  [10, 25], [Infinity, 5]],
  pcf: [[10, 95], [15, 75], [25, 50], [40, 25], [Infinity, 5]],
};

const GROWTH_STEPS = {
  yield:    [[0.05, 95], [0.03, 75], [0.015, 50], [0.005, 25]],
  eps_fwd:  [[0.30, 95], [0.20, 75], [0.10, 50],  [0.05, 25]],
  eps_hist: [[0.25, 95], [0.15, 75], [0.08, 50],  [0.03, 25]],
  rev:      [[0.20, 95], [0.10, 75], [0.05, 50],  [0.0, 25]],
  cf:       [[0.20, 95], [0.10, 75], [0.05, 50],  [0.0, 25]],
  bv:       [[0.20, 95], [0.10, 75], [0.05, 50],  [0.0, 25]],
};

// ---------------------------------------------------------------------------
// Raw value extraction helpers
// ---------------------------------------------------------------------------

function computeEpsHistGrowth(incomeQtrs) {
  // Uses netIncome as EPS proxy (basicEPS not returned by Yahoo Finance)
  const entries = incomeQtrs
    .map(q => ({ val: raw(q.netIncome), date: new Date(raw(q.endDate)).getTime() }))
    .filter(q => q.val != null && !isNaN(q.val) && q.date);

  if (entries.length < 5) return null;

  const newTTM = entries.slice(0, 4).reduce((s, q) => s + q.val, 0);
  const oldTTM = entries.slice(-4).reduce((s, q) => s + q.val, 0);

  if (oldTTM <= 0 || newTTM <= 0) return null;

  const newMidMs = entries[1].date;
  const oldMidMs = entries[entries.length - 3].date;
  const years = (newMidMs - oldMidMs) / (365.25 * 24 * 3600 * 1000);

  if (years < 0.5) return null;

  return Math.pow(newTTM / oldTTM, 1 / years) - 1;
}

function computeYoYGrowth(statements, field, periodOffset = 0) {
  if (!statements.length) return null;

  const vals = statements.map(s => raw(s[field])).filter(v => v != null && !isNaN(v));
  if (vals.length < 2) return null;

  let newSum, oldSum;
  if (periodOffset > 0) {
    // Shifted window: require full 8 quarters past the offset, no half-split fallback
    if (vals.length < periodOffset + 8) return null;
    newSum = vals.slice(periodOffset,     periodOffset + 4).reduce((s, v) => s + v, 0);
    oldSum = vals.slice(periodOffset + 4, periodOffset + 8).reduce((s, v) => s + v, 0);
  } else if (vals.length >= 8) {
    newSum = vals.slice(0, 4).reduce((s, v) => s + v, 0);
    oldSum = vals.slice(4, 8).reduce((s, v) => s + v, 0);
  } else {
    const half = Math.floor(vals.length / 2);
    newSum = vals.slice(0, half).reduce((s, v) => s + v, 0);
    oldSum = vals.slice(half).reduce((s, v) => s + v, 0);
  }

  if (oldSum === 0) return null;
  return (newSum - oldSum) / Math.abs(oldSum);
}

// CF growth using netIncome as proxy when operating CF quarters aren't available
function computeCFGrowth(cfStatements, incomeStatements, periodOffset = 0) {
  const fromCF    = computeYoYGrowth(cfStatements,     'totalCashFromOperatingActivities', periodOffset);
  if (fromCF != null) return fromCF;
  const fromCFInc = computeYoYGrowth(cfStatements,     'netIncome', periodOffset);
  if (fromCFInc != null) return fromCFInc;
  return computeYoYGrowth(incomeStatements, 'netIncome', periodOffset);
}

// options.periodOffset: 0 = TTM (current), N = shift the YoY-growth window
// back by N quarters. For periodOffset > 0 the point-in-time ratios
// (P/E, P/B, P/S, P/CF, dividend yield, EPS-fwd) are returned as null —
// Yahoo Finance only gives us a current snapshot of these. eps_hist
// uses the full history regardless of periodOffset (it's a 3-yr CAGR).
function extractRawValues(data, options = {}) {
  const periodOffset = options.periodOffset || 0;
  const isCurrent    = periodOffset === 0;
  const price = data.price || {};
  const fd    = data.financialData || {};
  const ks    = data.defaultKeyStatistics || {};
  const et    = data.earningsTrend || {};
  const iqbs  = data.balanceSheetHistoryQuarterly || {};
  const iqcf  = data.cashflowStatementHistoryQuarterly || {};
  const iqis  = data.incomeStatementHistoryQuarterly || {};

  const mktCap   = raw(price.marketCap);
  const curPrice = raw(price.regularMarketPrice);

  // P/E: use trailingPE if present, derive from price/trailingEps otherwise
  const trailingEps = raw(ks.trailingEps);
  const pe = raw(ks.trailingPE) ?? (curPrice && trailingEps ? curPrice / trailingEps : null);

  // P/S: use stored value if present, derive from marketCap/totalRevenue otherwise
  const totalRevenue = raw(fd.totalRevenue);
  const ps = raw(ks.priceToSalesTrailing12Months) ?? (mktCap && totalRevenue ? mktCap / totalRevenue : null);

  // P/CF: prefer operatingCashflow (more reliable than freeCashflow for this ratio)
  const opCF = raw(fd.operatingCashflow) || raw(fd.freeCashflow);
  const pcf  = mktCap && opCF ? mktCap / opCF : null;

  // Dividend yield: use financialData field if present, derive from lastDividendValue otherwise
  const storedYield = raw(fd.dividendYield);
  const lastDiv     = raw(ks.lastDividendValue);
  const yieldVal    = storedYield ?? (lastDiv && curPrice ? (lastDiv * 4) / curPrice : null);

  // EPS forward growth: prefer +1y period entry, fall back to trend[0]
  let epsFwdRaw = null;
  const trend = et.trend;
  if (Array.isArray(trend) && trend.length > 0) {
    const fwdEntry = trend.find(t => t.period === '+1y') || trend[0];
    epsFwdRaw = raw(fwdEntry?.earningsEstimate?.growth);
  }

  const cfStatements     = iqcf.cashflowStatements || [];
  const incomeStatements = iqis.incomeStatementHistory || [];

  return {
    pe:       isCurrent ? pe                 : null,
    pb:       isCurrent ? raw(ks.priceToBook) : null,
    ps:       isCurrent ? ps                  : null,
    pcf:      isCurrent ? pcf                 : null,
    yield:    isCurrent ? yieldVal            : null,
    eps_fwd:  isCurrent ? epsFwdRaw           : null,
    eps_hist: computeEpsHistGrowth(incomeStatements),
    rev:      isCurrent
              ? raw(fd.revenueGrowth)
              : computeYoYGrowth(incomeStatements, 'totalRevenue', periodOffset),
    cf:       computeCFGrowth(cfStatements, incomeStatements, periodOffset),
    bv:       computeYoYGrowth(iqbs.balanceSheetStatements || [], 'totalStockholderEquity', periodOffset),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function defaultScoringConfig() {
  const weights = {}, enabled = {};
  for (const { key } of [...VALUE_FACTORS, ...GROWTH_FACTORS]) {
    weights[key] = 1;
    enabled[key] = true;
  }
  return { weights, enabled };
}

function isDefaultScoringConfig(config) {
  if (!config) return true;
  const allKeys = [...VALUE_FACTORS, ...GROWTH_FACTORS].map(f => f.key);
  for (const k of allKeys) {
    const w = config.weights?.[k];
    const e = config.enabled?.[k];
    if (w != null && w !== 1) return false;
    if (e === false) return false;
  }
  return true;
}

function computeScores(data, config = {}, options = {}) {
  const rawVals = extractRawValues(data, options);
  const mktCap  = raw((data.price || {}).marketCap);

  const weights = config.weights || {};
  const enabled = config.enabled || {};
  const wOf = k => weights[k] != null ? weights[k] : 1;
  const eOf = k => enabled[k] !== false;

  const factors = {};

  for (const { key, label } of VALUE_FACTORS) {
    const r = rawVals[key];
    const w = wOf(key), en = eOf(key);
    if (r == null || isNaN(r)) { factors[key] = { raw: null, score: null, label, weight: w, enabled: en }; continue; }
    const score = key === 'yield'
      ? scoreGrowthFactor(r, GROWTH_STEPS.yield)
      : scoreValueFactor(r, VALUE_STEPS[key]);
    factors[key] = { raw: r, score, label, weight: w, enabled: en };
  }

  for (const { key, label } of GROWTH_FACTORS) {
    const r = rawVals[key];
    const w = wOf(key), en = eOf(key);
    if (r == null || isNaN(r)) { factors[key] = { raw: null, score: null, label, weight: w, enabled: en }; continue; }
    factors[key] = { raw: r, score: scoreGrowthFactor(r, GROWTH_STEPS[key]), label, weight: w, enabled: en };
  }

  function weightedAvg(keys) {
    let weightedSum = 0, weightTotal = 0;
    for (const k of keys) {
      const f = factors[k];
      if (f.score == null || !f.enabled || f.weight <= 0) continue;
      weightedSum += f.score * f.weight;
      weightTotal += f.weight;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : null;
  }

  const valueScore  = weightedAvg(VALUE_FACTORS.map(f => f.key));
  const growthScore = weightedAvg(GROWTH_FACTORS.map(f => f.key));

  if (valueScore == null || growthScore == null) {
    return { valueScore, growthScore, netScore: null, style: 'Unknown', size: getSize(mktCap), factors };
  }

  const netScore = growthScore - valueScore;
  const style    = netScore > 15 ? 'Growth' : netScore < -15 ? 'Value' : 'Blend';

  return { valueScore, growthScore, netScore, style, size: getSize(mktCap), factors };
}
