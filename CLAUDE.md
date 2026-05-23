# Stock Style Analyzer — Codebase Guide for Claude

A single-page app that scores stocks on Value and Growth dimensions, plots them on a 3×3 style box, and lets you compare multiple watchlists of stocks side by side. Each list can hold per-ticker weights to model a built portfolio and visualize its aggregate style. The frontend is plain HTML/CSS/JS — no framework, no build step. A tiny Node/Express server proxies requests to Yahoo Finance because direct browser access is blocked by CORS.

---

## File Map

| File | Purpose |
|---|---|
| `index.html` | Shell. PWA meta tags, manifest link, service-worker registration. Loads `styles.css`, `scoring.js`, `app.js`, and `marked.js` (CDN, for the help modal). |
| `styles.css` | Full design system. CSS variables in `:root`. No external dependencies. |
| `scoring.js` | **Pure** scoring engine — factor definitions, threshold tables, weight handling, `computeScores()`. Zero DOM dependencies. Loaded before `app.js`. |
| `app.js` | Everything else — state, routing, page renders, modals, watchlist actions, style-box rendering. Top-of-file `API_BASE` constant points fetches at the Cloudflare Worker when deployed; local dev (`localhost`) keeps relative `/api/...`. |
| `server.js` | Express server for **local dev**. Serves static files and exposes `GET /api/quote/:ticker`. In-memory 5-minute cache. |
| `worker/worker.js` | Cloudflare Worker that mirrors `server.js` for **static deploys** (GitHub Pages). Same `GET /api/quote/:ticker` contract. Handles Yahoo crumb/cookie + edge cache. |
| `worker/wrangler.toml` | Wrangler config for the Worker. `wrangler deploy` from `worker/` publishes it. |
| `manifest.json` | PWA web app manifest — name, icons, theme color, display mode. |
| `service-worker.js` | Network-first cache for the app shell. Live `/api/quote/*` requests are passed through (never cached). Bump `CACHE_VERSION` to force eviction. |
| `icons/icon.svg` | Single SVG icon used for favicon, apple-touch-icon, and manifest. Placeholder 3×3 colored grid — swap with real artwork when you have it. |
| `package.json` | ESM, three dependencies: `express`, `cors`, `yahoo-finance2`. (Dev only; the Worker has no `node_modules`.) |
| `README.md` | End-user instructions + deploy steps. |
| `PLAN.md` | Original build plan. Phases 1–6 complete. |

---

## Architecture

Single-page app with manual routing. Pages are functions that return HTML strings assigned to `document.getElementById('main').innerHTML`. No framework, no virtual DOM, no reactivity — render functions are called explicitly via `navigate()`.

### State

```js
const state = {
  data: null,        // persisted to localStorage under STORAGE_KEY
  page: 'dashboard',
  params: {},        // current page params
};

let currentQuote  = null;             // last fetched quote (not persisted)
let currentPeriod = 0;                // 0 = TTM, N = N quarters back (not persisted)
let watchlistSort = { col: 'net', dir: 'desc' };  // watchlist sort state (not persisted)
```

`state.data` is loaded from localStorage on init and saved via `saveData()` after every mutation.

### Navigation

```js
navigate(page, params = {})
```

Sets `state.page` / `state.params`, updates sidebar active class, calls the matching `render*()`, sets `#main.innerHTML`. Sub-pages without a sidebar entry are mapped in `SIDEBAR_MAP` (currently empty — all pages have sidebar entries).

---

## Data Model

Stored in `state.data` and persisted as a single JSON blob to localStorage under `STORAGE_KEY = 'stock_analyzer_v1'` (the key name keeps the old string for in-place migration; the schema is now `version: 2`).

```js
{
  version: 2,
  stocks: Stock[],        // master pool: every ticker that's in at least one list
  lists:  List[],         // multiple named watchlists; tickers can belong to >1 list
  activeListId: string,   // which list the Watchlist page currently shows
  settings: {
    appName: 'Stock Style Analyzer',
    scoringConfig: { weights: {...}, enabled: {...} },
  },
}
```

`stocks` is a deduplicated master pool. When a ticker is removed from its last list, it is garbage-collected from `stocks` too (no orphan snapshots).

### Stock

```js
{
  ticker,      // 'AAPL'
  name,        // 'Apple Inc.'
  addedAt,     // ISO date
  snapshot,    // Snapshot | null  — null for pre-Phase-6 entries
}
```

### List

```js
{
  id:         string,            // uuid
  name,                          // 'Bank Stocks'
  createdAt,                     // ISO date
  tickers: [
    { ticker, weight, addedAt }, // weight is a raw number; normalized at display time
    ...
  ],
}
```

A ticker can appear in multiple lists with **different weights per list**.

### Snapshot

Captured by `makeSnapshot(scores, periodOffset, cfg, data)` whenever a stock is added or refreshed:

```js
{
  valueScore,   // 0–100 or null
  growthScore,  // 0–100 or null
  netScore,     // -100..+100 or null
  style,        // 'Value' | 'Blend' | 'Growth' | 'Unknown'
  size,         // 'large' | 'mid' | 'small' | 'unknown'
  fetchedAt,    // ISO date
  periodOffset, // 0 = TTM, N = N quarters back
  periodLabel,  // 'TTM' or 'Q3 2024'
  scoringConfigUsed,  // deep-cloned weights/enabled at snapshot time
}
```

The watchlist style box plots each stock using its own snapshot — **not** the current scoring config. Refresh a row to re-score with the current settings.

---

## Scoring Engine (`scoring.js`)

Pure module. Exposes (as globals) `VALUE_FACTORS`, `GROWTH_FACTORS`, `defaultScoringConfig()`, `isDefaultScoringConfig()`, `computeScores(data, config, options)`, `computeAggregateScores(entries)`.

Each factor has a key (`pe`, `pb`, `ps`, `pcf`, `yield`, `eps_fwd`, `eps_hist`, `rev`, `cf`, `bv`) and a fixed threshold table that maps raw values to 0–100 scores.

`computeScores(data, config, { periodOffset })`:
- For Value factors and `eps_fwd`/`yield` (point-in-time data): only computed when `periodOffset === 0`. Yahoo Finance does not return historical multiples.
- For YoY-growth factors (`rev`, `cf`, `bv`): recomputed from quarterly statements, shifted by `periodOffset`.
- `eps_hist`: 3-year CAGR using netIncome as an EPS proxy (Yahoo doesn't return basicEPS).
- Returns `{ valueScore, growthScore, netScore, style, size, factors }`. Each `factors[key]` has `{ raw, score, label, weight, enabled }`.

`computeAggregateScores(entries)` rolls a list of stocks into a single "portfolio" score:
- `entries` is `[{ ticker, snapshot, weight }]`. Stocks with null `valueScore`/`growthScore` are skipped and the remaining weights are renormalized to sum to 1.
- All-zero or all-missing weights fall back to equal weight.
- `size` is a weighted average over a numeric size index (large=0, mid=1, small=2), rounded back to a label.
- Returns `{ valueScore, growthScore, netScore, style, size, included, total, normalizedWeights }`.

To add a factor: append to `VALUE_FACTORS` or `GROWTH_FACTORS`, add a threshold table to `VALUE_STEPS` or `GROWTH_STEPS`, and add a key to `extractRawValues()`. The settings page picks it up automatically.

---

## Server (`server.js`)

`GET /api/quote/:ticker` calls `yahooFinance.quoteSummary()` with the seven modules the frontend needs and returns `{ ok: true, ticker, data }`. Errors return `{ ok: false, error }` with HTTP 400 / 404 / 429. The 5-minute in-memory cache avoids hammering Yahoo on repeat lookups.

Ticker input is validated against `/^[A-Z0-9.\-^=]+$/` before any external call.

---

## UI Patterns

### Style Box — `renderStyleBox(stocks, options)`

Renders a 3×3 SVG grid with one dot per stock. Each `stocks[i]` is `{ ticker, scores, color?, weight? }` where `scores` is `{ netScore, size, style }`.

- Dot colors cycle through `STOCK_COLORS` (8 palette entries) unless an explicit `color` is supplied
- If any stock has a positive `weight`, dot radii are scaled by `sqrt(share / equalShare)` so dot **area** visually tracks the stock's share of the portfolio (clamped to 0.5×–1.9× of base R). Omit `weight` for equal sizing.
- Dots within 2 × maxR of each other are clustered and their labels alternated left/right
- Label side falls back to the opposite edge if it would clip the box bounds
- `data-ticker` and `data-r` attributes on dots let hover handlers find and resize them
- `options.width` controls the SVG size (default 240; dashboard uses 160 for a mini box)

`highlightStyleBoxDot(ticker)` / `resetStyleBoxDots()` are wired to `onmouseenter` / `onmouseleave` on watchlist and dashboard rows.

### Modals

`showModal(title, bodyHtml, onSave, saveLabel)` — `onSave` returns `true` to close, `false` to keep open. `showConfirm(title, msg, onConfirm)` for destructive actions. `hideModal()` is also triggered by clicking the overlay backdrop.

### Toasts

`showToast(msg, type)` — `type` is `''` (dark), `'success'` (green), or `'error'` (red). Auto-removes after 3.2s.

### Help Modal

`showHelpModal(tab)` opens a wide modal with User Guide and Developer Guide tabs. Fetches `README.md` and `CLAUDE.md` at runtime and renders with `marked.parse()`. The `?` button in the sidebar logo triggers it.

### HTML Escaping

`esc(str)` escapes `& < > "`. Use everywhere user-supplied or external data appears in template literals (ticker names, factor values, etc.).

---

## Watchlist Specifics

The Watchlist page renders **one list at a time** — the one whose `id` matches `state.data.activeListId`. A dropdown selector at the top of the page switches lists, with `+ New / Rename / Delete` actions. Per-list ticker entries store a raw `weight` number; the table shows both the editable raw value and the normalized % (renormalized live across the list). The page renders two style boxes side-by-side:

- **Individual Stocks** — one dot per ticker, dot size scaled by weight share.
- **Portfolio Aggregate** — a single dot computed via `computeAggregateScores()` using the same weights.

Each stock's palette color is assigned by its **insertion index within the current list** (not the master pool), so colors stay distinct within a short list even if the master pool is large. `sortStocks(stocks, col, dir)` accepts a `weight` column too; nulls always sort to the bottom.

A snapshot is considered stale once `Date.now() - fetchedAt > 7 days` (see `SNAPSHOT_STALE_MS`). The stale badge is purely visual — staleness does not block any action.

`refreshWatchlistStock(ticker)` always re-fetches with `periodOffset: 0` (TTM) and re-scores using the current `scoringConfig`. The user can still pick historical periods from the Lookup page.

### List membership helpers (`app.js`)

- `getActiveList()` — returns the list referenced by `activeListId` (or first list as fallback).
- `getListsForTicker(ticker)` — lists that contain a given ticker.
- `addTickerToList(listId, ticker, { name, snapshot, weight })` — ensures the ticker is in the master `stocks` pool (creating an entry if needed), then appends to the list. No-op if already present.
- `removeTickerFromList(listId, ticker)` — removes from that list; garbage-collects the master `stocks` entry if the ticker is now in zero lists.
- `setStockWeight(listId, ticker, weight)` — updates the weight and re-renders.
- `setActiveList(listId)` — switches the active list and re-renders.
- `showAddToListsModal(ticker)` — multi-select checkbox modal; pre-checks the active list for brand-new tickers, pre-checks current memberships for existing ones. Supports inline list creation.
- `promptNewList()` / `promptRenameList(id)` / `confirmDeleteList(id)` — list CRUD modals. Deleting the last list is blocked. Deleting a list garbage-collects any tickers it contained that aren't in any other list.

---

## Adding a New Page

1. Write a `renderFoo()` returning HTML.
2. Add a `case 'foo':` in `navigate()`.
3. Add a nav entry in `buildSidebar()` if it needs a sidebar item.
4. If it's a sub-page, add it to `SIDEBAR_MAP`.

## Adding a Field to the Stock or Snapshot

1. Update `makeSnapshot()` (or the stock initializer in `addTickerToList`).
2. Add a migration line in `migrateData()` so older saves get a default — both `loadData()` and `triggerImport()` run through it.
3. Render the field where it should appear.
4. Existing records without the field will get `undefined` — use `?? defaultValue` defensively.

---

## Key Constants

```js
STORAGE_KEY        = 'stock_analyzer_v1'
STOCK_COLORS       // 8-color palette for multi-dot style box
SNAPSHOT_STALE_MS  // 7 days
SIDEBAR_MAP        // sub-page → parent (currently empty)
```

In `scoring.js`:

```js
VALUE_FACTORS, GROWTH_FACTORS   // {key, label} arrays
VALUE_STEPS, GROWTH_STEPS       // threshold tables per factor key
SIZE_THRESHOLDS                 // market cap bands for Large/Mid/Small
```

---

## Known Limits

- Historical multiples (P/E etc) are point-in-time only — N/A for any non-TTM period
- Yahoo Finance occasionally throttles; the server returns a friendly 429 with retry guidance
- `eps_hist` uses netIncome as a proxy because Yahoo doesn't return basicEPS in `quoteSummary`
- Multi-dot label placement is two-state (left/right) — three overlapping dots may still have crowded labels
