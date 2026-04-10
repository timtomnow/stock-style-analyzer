# Stock Style Analyzer — User Guide

> Score stocks on Value and Growth dimensions using a 3×3 style box framework.

## How to Run

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the server
node server.js

# 3. Open in browser
open http://localhost:3000
```

An internet connection is required — stock data is fetched from Yahoo Finance.

---

## Features

### Dashboard

Overview of your watchlist and a quick-start guide to the app.

---

### Stock Lookup

Enter any ticker symbol (e.g. `AAPL`, `MSFT`, `WMT`) and click **Fetch** to pull fundamentals from Yahoo Finance.

Key metrics displayed:
- Price, Market Cap
- Trailing P/E, Forward P/E, P/B, P/S, EV/EBITDA
- Revenue Growth, Earnings Growth, Return on Equity
- Free Cash Flow, Dividend Yield, Beta

Click **+ Add to Watchlist** to save the stock for later comparison.

**Coming in Phase 2:** Value Score, Growth Score, and Net Style Score computed from 10 fundamental factors.

**Coming in Phase 3:** Interactive 3×3 Style Box visualization (Value / Blend / Growth × Large / Mid / Small).

---

### Watchlist

Saved stocks. Click **Analyze** to jump to the Lookup page for any saved stock.

---

### Settings

Rename the app. Export or import your watchlist as a JSON backup.

---

## Data Storage

Your watchlist is saved automatically in the browser's **local storage** after every change.

- **Export** regularly via Settings or the sidebar footer
- **Import** to restore from a backup (replaces all current data)

---

## Tips

- Press **Enter** in the ticker input to fetch without clicking the button
- The **?** button in the sidebar opens this guide
- All data is local — nothing is sent to any server except Yahoo Finance requests via `localhost:3000`
