# Stock Style Analyzer — User Guide

> Score stocks on Value and Growth dimensions using a 3×3 style box framework. Organize stocks into multiple named watchlists, assign portfolio weights, and visualize the aggregate style of a built portfolio.

## How to Run

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the server
node server.js

# 3. Open in browser
open http://localhost:3000
```

An internet connection is required — stock fundamentals are fetched from Yahoo Finance through the local server.

---

## Pages

### Dashboard

Quick overview of every stock you've saved (across all watchlists). When you've saved stocks, the dashboard shows:

- Stat cards: total **Stocks**, number of **Lists**, and how many have been **Scored**
- A **mini style box** with the top 5 stocks by Net Score plotted as colored dots
- A compact table of those 5 stocks with their style and net score
- Hover any row to highlight the matching dot, or click to jump to its analysis

When no stocks are saved, the dashboard shows a short "how it works" guide instead.

---

### Stock Lookup

Enter a ticker symbol (e.g. `AAPL`, `MSFT`, `WMT`) and click **Fetch** (or press Enter) to pull fundamentals from Yahoo Finance.

You'll see:

- **Header** — current price, market cap, ticker name, fetch timestamp
- **Period selector** — analyze the stock as of TTM (default) or any of the last few quarters
- **Key Fundamentals** — P/E, P/B, P/S, EV/EBITDA, revenue growth, earnings growth, ROE, free cash flow, dividend yield, beta
- **Style Scores** — Value Score (0–100), Growth Score (0–100), and overall Style (Value / Blend / Growth × Large / Mid / Small)
- **Style Box** — the stock plotted at its computed position on a 3×3 grid
- **Factor Breakdown** — every value and growth factor with its raw number, weight, and 0–100 score
- **Raw API Response** — collapsible debug view of the full Yahoo Finance payload

Click **+ Add to Watchlist** to choose which list(s) the stock belongs to. The popup shows every watchlist as a checkbox, lets you create new lists inline, and pre-checks the currently active list for brand-new tickers. The button changes to **In N lists ▾** for stocks already saved — click it any time to add or remove memberships.

#### Historical periods

The period dropdown lets you re-score the stock as of an earlier quarter. Only periods with enough quarterly history to compute at least two growth factors are listed.

When you pick a historical quarter, valuation ratios (P/E, P/B, P/S, P/CF, Dividend Yield, EPS Fwd) are shown as N/A and excluded from scoring — Yahoo Finance does not return historical price-based multiples. Growth factors (revenue growth, cash flow growth, book value growth) are recomputed from the quarterly statements.

---

### Watchlist

The Watchlist page shows **one list at a time**. Use the dropdown at the top to switch between lists, or use the toolbar buttons to manage them:

- **+ New** — create a new list (e.g. "Bank Stocks", "Dividend Stocks", "Tech Stocks")
- **Rename** — rename the active list
- **Delete** — remove the active list (blocked if it's your only one)

A ticker can live in any number of lists — adding a stock to a second list doesn't create a copy. Removing a ticker from its last list garbage-collects its snapshot.

#### Plots

Two style boxes render side by side:

1. **Individual Stocks** — one colored dot per ticker. **Dot size scales with the stock's portfolio weight** — heavier weights = bigger dots.
2. **Portfolio Aggregate** — a single dot showing the weighted-average position of the whole list, plus a Value / Growth / Net / Style summary. Stocks with no score yet are skipped and the remaining weights are renormalized.

#### Per-ticker weights

Each list stores its own weight per ticker. The **Weight** column in the table is editable — type any non-negative number (e.g. `1`, `3`, `0.5`, or shares-held counts) and weights are normalized to 100% across the list when computing the aggregate and the dot sizes. The normalized percentage is shown next to each weight.

By default every new ticker is added at weight `1`, giving equal-weight aggregation across the list. Set all weights equal to keep equal-weight; change them to model a built portfolio (e.g. 50% AAPL, 30% MSFT, 20% NVDA → `5`, `3`, `2`).

#### Table

Columns: Ticker, Name, Weight, Style, Size, Value, Growth, Net, Period, Refreshed, Actions. Click any column header to sort. Default sort is Net descending.

- **Hover a row** to highlight that stock's dot in the box above
- **Click a row** (anywhere outside the weight input or action buttons) to jump to its Lookup page
- **Refresh** re-fetches the ticker and updates its snapshot using your current scoring weights (the snapshot is shared across all lists that contain the ticker)
- **Remove** drops the stock from the **active list only** — other lists keep it

#### Stale snapshots

A small `stale` badge appears next to the Refreshed date when a snapshot is more than 7 days old. Click Refresh on that row to update.

#### How positions are computed

Each individual stock's dot reflects the scoring weights that were active **when it was last refreshed**, not your current settings. Refresh a row to re-score it with the current weights. The aggregate uses whatever scores are in the snapshots — refresh everything for a fresh portfolio view.

---

### Settings

- **Scoring Weights** — every Value and Growth factor has a 0–3× slider and an enable toggle. Disabled or zero-weight factors are excluded from the average. A `Custom` badge appears when any weight differs from the defaults.
- **General** — rename the app (shows in the sidebar logo)
- **Data** — export your watchlist (including snapshots) as JSON, or import a backup. Import replaces all current data.

---

## Scoring Engine

Each stock is scored on 10 factors split between Value and Growth:

| Value (lower = more value) | Growth (higher = more growth) |
|---|---|
| P/E Ratio | EPS Forward Growth |
| P/B Ratio | EPS Historical Growth (3yr CAGR) |
| P/S Ratio | Revenue Growth |
| P/CF Ratio | Cash Flow Growth |
| Dividend Yield | Book Value Growth |

Each factor is mapped to a 0–100 score against fixed thresholds (e.g. P/E < 10 → 95, P/E 10–15 → 75, ...). The Value Score and Growth Score are weighted averages of their 5 factors. **Net Score = Growth − Value**.

- **Net > +15** → Growth
- **−15 to +15** → Blend
- **Net < −15** → Value

Size is determined by market cap: > $10B = Large, $2B–$10B = Mid, < $2B = Small.

If a factor's data is missing, that factor is excluded from the average. A warning appears if fewer than 3 of 5 factors on either side have data.

---

## Data Storage

Everything is saved to your browser's **local storage** after each change — your watchlist, settings, snapshots. Nothing is sent to any server other than the local proxy (which only forwards ticker requests to Yahoo Finance).

- **Export** regularly via Settings or the sidebar footer for backups
- **Import** restores from a backup (replaces all current data, including snapshots)
- The JSON export contains complete snapshots, so you can move a watchlist between machines without re-fetching

---

## Tips

- Press **Enter** in the ticker input to fetch
- The **?** button in the sidebar opens this guide and the developer guide
- Click the **Custom weights active** badge on the Lookup page to jump to Settings
- The server caches each ticker for 5 minutes — repeat lookups don't hit Yahoo Finance
- If you see a "rate limit" error, wait 30–60 seconds before retrying
