# Stock Style Analyzer — Build Plan

> Goal: score individual stocks on Value and Growth dimensions, plot them in a 3×3 style box, and eventually compare groups of stocks by style over time.

---

## Starting Fresh (read this first)

**The existing `index.html`, `app.js`, `styles.css` are a generic template — they need to be repurposed, not preserved.** The Items/Categories/Dashboard boilerplate in the current `app.js` should be replaced with the stock analyzer pages. The CSS design system and utility functions (`esc`, `uuid`, `showModal`, `showToast`, `navigate`, etc.) are worth keeping — the domain-specific content is not.

**To start a new session:** read `PLAN.md` (this file) and check which phases are marked complete. Then pick up at the next incomplete phase. No other context is needed.

---

## Likelihood of Success

**High — roughly 85–90% confidence** this can be built to a working, useful state in a few focused sessions.

- Yahoo Finance data via `yahoo-finance2` (npm) is mature, well-maintained, and covers all the ratios needed
- The scoring engine is pure math — no ML, no black box
- The style box UI is straightforward CSS/SVG
- The main risk is **historical fundamental data**: Yahoo Finance's free data has gaps for older quarters. For TTM (trailing twelve months) and recent quarters, coverage is very good. For pulling a specific quarter 3 years ago, it gets spotty. That's acceptable for V1.

---

## What the Style Box Measures

The style box uses **10 factors** split equally between two scores:

### Value Score (5 factors, equal weight)
| Factor | Metric |
|---|---|
| Price/Earnings | Forward P/E or Trailing P/E |
| Price/Book | P/B ratio |
| Price/Sales | P/S ratio |
| Price/Cash Flow | P/CF ratio |
| Dividend Yield | Trailing 12-month yield |

### Growth Score (5 factors, equal weight)
| Factor | Metric |
|---|---|
| Long-Term EPS Growth | Analyst forward estimate |
| Historical EPS Growth | 3-year EPS CAGR |
| Sales Growth | Revenue growth YoY or 3yr CAGR |
| Cash Flow Growth | Operating/Free CF growth YoY |
| Book Value Growth | BV per share growth YoY |

**Net Score = Growth Score − Value Score**

- High positive → **Growth**
- Near zero → **Blend**
- High negative → **Value**

Size (Large/Mid/Small) is determined separately by market cap relative to a universe — for a single-stock tool, you can use absolute thresholds (e.g. >$10B = Large, $2B–$10B = Mid, <$2B = Small).

---

## Architecture Decision: We Need a Tiny Backend

**Problem:** Yahoo Finance blocks direct browser requests (CORS). A purely frontend app can't call it.

**Solution:** Add a minimal Node.js/Express server that:
1. Serves the existing `index.html` / `app.js` / `styles.css` as static files (replacing `python3 -m http.server`)
2. Exposes a single `/api/quote/:ticker` endpoint that calls `yahoo-finance2` and returns the data the frontend needs

This keeps almost all complexity in the frontend where it already lives. The backend is ~50 lines.

**Why not a third-party API?**
- Alpha Vantage, FMP, etc. require API keys and have rate limits on free tiers
- `yahoo-finance2` works without any key and returns richer data
- If Yahoo Finance eventually breaks (it has before), swapping to FMP is a one-file backend change

---

## Key Packages

| Package | Purpose | Maturity |
|---|---|---|
| `yahoo-finance2` | Fetch fundamentals, financials, estimates from Yahoo Finance | Very stable, actively maintained |
| `express` | Minimal HTTP server + static file serving | Industry standard |
| `cors` | Enable frontend-to-backend requests during dev | Standard |

No frontend framework changes needed. The existing vanilla JS pattern is kept.

---

## Data Available from `yahoo-finance2`

All fetched via `yahooFinance.quoteSummary(ticker, { modules: [...] })`:

```
financialData         → P/E, P/B, revenue growth, earnings growth, free CF
defaultKeyStatistics  → P/S, EV/EBITDA, forward P/E, trailing EPS, book value
incomeStatementHistoryQuarterly  → revenue, net income per quarter
cashflowStatementHistoryQuarterly → operating CF, free CF per quarter
balanceSheetHistoryQuarterly     → total equity, book value per quarter
earningsTrend         → analyst growth estimates (1yr, 5yr EPS)
price                 → market cap, current price
```

This is more than enough to compute all 10 style box factors and more.

**Historical period support:** You can fetch the quarterly history arrays and compute TTM or pick a specific set of 4 quarters. Going back 8 quarters (2 years) is reliably available for most large/mid cap stocks.

---

## Phased Build Plan

### Phase 1 — Foundation & Data Layer ✅ COMPLETE
**Goal:** Enter a ticker, get back raw fundamental data displayed on screen.

- [x] Add `package.json`, install `express`, `yahoo-finance2`, `cors`
- [x] Write `server.js` (~50 lines):
  - Serve static files from project root
  - `GET /api/quote/:ticker` → calls `quoteSummary`, returns JSON
- [x] Add a `.gitignore` for `node_modules/`
- [x] Update `README.md` with new "run `node server.js`" instructions
- [x] In the frontend, add a **Stock Lookup** page with a ticker input and "Fetch" button
- [x] Display the raw returned data in a debug panel (just confirm the pipeline works)

**Success criteria:** Type `AAPL`, click Fetch, see P/E, P/B, revenue growth numbers appear.

---

### Phase 2 — Scoring Engine ✅ COMPLETE
**Goal:** Compute Value Score and Growth Score from the raw data.

The scoring engine is a pure JS module (no dependencies):

```js
// scoringEngine.js (or inline in app.js)

// Each factor: { key, label, extract(rawData), direction ('lower_is_value' | 'higher_is_growth') }
const VALUE_FACTORS = [
  { key: 'pe',    label: 'P/E',         extract: d => d.financialData.currentPrice / d.financialData.earningsGrowth, ... },
  { key: 'pb',    label: 'P/B',         extract: d => d.defaultKeyStatistics.priceToBook },
  { key: 'ps',    label: 'P/S',         extract: d => d.defaultKeyStatistics.priceToSalesTrailing12Months },
  { key: 'pcf',   label: 'P/CF',        extract: d => ... },
  { key: 'yield', label: 'Div. Yield',  extract: d => d.financialData.dividendYield },
];

const GROWTH_FACTORS = [
  { key: 'eps_fwd',  label: 'EPS Fwd Growth',  extract: d => d.earningsTrend... },
  { key: 'eps_hist', label: 'EPS Hist Growth',  extract: d => ... computed from quarterly history },
  { key: 'rev',      label: 'Revenue Growth',   extract: d => d.financialData.revenueGrowth },
  { key: 'cf',       label: 'CF Growth',        extract: d => ... },
  { key: 'bv',       label: 'Book Value Growth',extract: d => ... computed from quarterly balance sheet },
];
```

**Scoring approach (simple, transparent):**
1. For each factor, compare the stock's raw value to sector/market median (or use percentile-style scoring against a benchmark table you hardcode for V1)
2. Map to 0–100 scale (0 = extreme value/low growth, 100 = extreme growth/high value)
3. Average the 5 value factors → **Value Score 0–100**
4. Average the 5 growth factors → **Growth Score 0–100**
5. **Net Score = Growth Score − Value Score** (range: −100 to +100)
6. Style = Net Score > 15 → Growth | < −15 → Value | else → Blend

**Note on benchmarks:** For V1, hardcode a simple percentile table (e.g. P/E: < 12 = deep value, 12–20 = value, 20–35 = blend, 35–60 = growth, > 60 = deep growth). This is transparent and user-adjustable. More sophisticated universe-relative scoring can be added later.

**Success criteria:** AAPL scores ~65 growth, ~40 value → Blend/Growth. WMT scores ~70 value, ~30 growth → Value.

---

### Phase 3 — Style Box Visualization ✅ COMPLETE
**Goal:** Render the classic 3×3 box and plot the stock in it.

```
┌──────────┬──────────┬──────────┐
│  Large   │  Large   │  Large   │
│  Value   │  Blend   │  Growth  │
├──────────┼──────────┼──────────┤
│   Mid    │   Mid    │   Mid    │
│  Value   │  Blend   │  Growth  │
├──────────┼──────────┼──────────┤
│  Small   │  Small   │  Small   │
│  Value   │  Blend   │  Growth  │
└──────────┴──────────┴──────────┘
```

Implementation: SVG element in the DOM (no external charting library needed). The stock plots as a colored circle at (x, y) where:
- x = Growth–Value net score mapped to 0–100% of box width
- y = Size (Large/Mid/Small) mapped to top/middle/bottom third

The circle can be continuous (not snapped to a cell) for a smoother, more informative result — showing *how* growth or value the stock is, not just which box it falls in.

---

### Phase 4 — Configurable Weights ✅ COMPLETE
**Goal:** Let users change exactly which factors count and how much.

- **Weights panel:** Each factor gets a slider (0–3x) for its contribution weight
- **Factor toggle:** Each factor can be enabled/disabled
- **Custom factors:** Allow adding a custom ratio with a custom formula (V2 stretch goal)
- Settings are stored in `localStorage` under the existing `state.data.settings` pattern

The scoring engine accepts a `config` object:
```js
computeScores(rawData, config) // config = { valueWeights: {...}, growthWeights: {...} }
```

This means the scoring is fully transparent and reproducible.

---

### Phase 5 — Date / Period Selection ✅ COMPLETE
**Goal:** Analyze a stock as of a specific period (e.g. "as of Q2 2023").

- Dropdown: "TTM", "Q4 2024", "Q3 2024", etc. (last 8 quarters, dynamically built from the fetched data)
- The backend already returns quarterly arrays — the frontend just slices to the right 4 quarters
- Computed scores are re-derived from whichever period's data is selected
- This enables seeing how a stock's style has shifted over time

**Stretch for this phase:** A small time-series chart showing how the Net Style Score has moved quarter by quarter over the last 2 years.

---

### Phase 6 — Stock History & Comparison ✅ COMPLETE
**Goal:** Save multiple analyzed stocks and compare them.

- [x] Analyzed stocks are saved to `state.data.stocks[]` with scoring snapshots persisted to localStorage
- [x] **Watchlist** view shows a sortable table of saved stocks with their scores and a multi-dot style box above it
- [x] Multiple stocks plot on the same style box, each with a distinct color from an 8-entry palette
- [x] Per-row Refresh re-scores using current weights; >7-day-old snapshots show a `stale` badge
- [x] Dashboard shows top-5-by-net-score in a mini style box when stocks are saved
- [x] Hovering a row highlights its dot in the box; clicking jumps to the Lookup page

---

## V1 Polish — Cleanup Pass ✅ COMPLETE

- [x] README rewritten to cover all current features (scoring, style box, period selector, weights, watchlist comparison)
- [x] CLAUDE.md updated to reflect actual architecture (scoring.js, server.js, snapshot shape, watchlist sort state)
- [x] Raw API debug pane gated behind a collapsible `<details>` toggle (collapsed by default)
- [x] Phase X / "coming soon" hints removed from UI copy
- [x] Stat card on Dashboard switched from "Phase 2" to live "Scored" count

---

### Future / V2 Goals (not in immediate scope)
- **Universe-relative scoring:** Fetch a basket of stocks (S&P 500 or sector) to score relative to peers rather than absolute thresholds
- **Style correlation analysis:** Group stocks, compute correlation between style cluster membership and forward returns
- **Style drift tracking:** Show how a stock or group has moved through style boxes over time, animated
- **Export:** Download style box as PNG, export scores as CSV

---

## File Structure After Phase 1

```
stock-style-analyzer/
├── index.html          (existing — add <script src="scoring.js"> before app.js)
├── styles.css          (existing — add style box CSS)
├── scoring.js          (NEW — pure scoring engine: factor definitions, weights, computeScores())
├── app.js              (existing — routing, state, UI rendering, style box SVG, fetch calls)
├── server.js           (NEW — ~50 lines, Express + yahoo-finance2)
├── package.json        (NEW)
├── package-lock.json   (NEW)
├── .gitignore          (NEW — node_modules/)
├── README.md           (update run instructions)
├── CLAUDE.md           (update architecture notes)
├── PLAN.md             (this file)
└── Stylebox_Factsheet.pdf
```

### Why `scoring.js` is separate

The scoring engine is the core intellectual logic of this project — factor definitions, benchmark thresholds, weight configs, normalization math. It has zero DOM dependencies and will be iterated heavily (adding factors, tuning thresholds). Keeping it separate makes it easy to reason about, test, and eventually run against groups of stocks. Everything else (routing, UI, SVG rendering, state) stays in `app.js`.

`index.html` loads scripts in order: `<script src="scoring.js"></script>` then `<script src="app.js"></script>`. No build step needed.

---

## Known Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Yahoo Finance rate-limiting or blocking | Low–Medium | Add response caching in server.js; fallback to FMP API |
| Missing data for specific ratios on some tickers | Medium | Gracefully show "N/A" and exclude that factor from scoring; don't break |
| Historical quarterly data gaps (older periods) | Medium | Limit period picker to last 6–8 quarters where data is reliable |
| P/CF or Book Value Growth computation is complex | Low | Well-documented; `yahoo-finance2` returns raw quarterly statements |
| Benchmark thresholds feel arbitrary in V1 | Medium | Document them explicitly; make them user-configurable in Phase 4 |

---

## Quick-Start Commands (After Phase 1)

```bash
# Install dependencies
npm install

# Start the server (replaces python3 -m http.server)
node server.js

# Open in browser
open http://localhost:3000
```

---

## Summary

This is a well-scoped, achievable project. The data layer is the only part that requires real-world testing (Yahoo Finance data quality varies by ticker), but `yahoo-finance2` is widely used and the data it returns for large-cap stocks is comprehensive. Phases 1–3 can realistically be completed in 2–3 focused work sessions, giving a working, interactive style box with real data. Phases 4–5 add the configurability that makes it genuinely useful for research.
