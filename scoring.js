'use strict';

// ═══════════════════════════════════════════════════════════════
// SCORING ENGINE
// Pure JS — no DOM dependencies. Loaded before app.js.
// Phase 2 will flesh out factor definitions, thresholds, and
// computeScores(). This stub exposes the public API shape.
// ═══════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Factor definitions (Phase 2)
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
// Main entry point (Phase 2 will complete this)
// ---------------------------------------------------------------------------

// computeScores(rawData, config?) → { valueScore, growthScore, netScore, style, size, factors }
function computeScores(rawData, config = {}) {
  // Stub: returns null until Phase 2 is implemented
  return null;
}
