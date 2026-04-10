import express from 'express';
import cors from 'cors';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3000;

// Simple in-memory cache — avoids hammering Yahoo Finance on repeated lookups
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map(); // ticker → { data, fetchedAt }

app.use(cors());
app.use(express.static(__dirname));

app.get('/api/quote/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase().trim();
  if (!ticker || !/^[A-Z0-9.\-^=]+$/.test(ticker)) {
    return res.status(400).json({ ok: false, error: 'Invalid ticker symbol' });
  }

  // Serve from cache if fresh
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(`[cache] ${ticker}`);
    return res.json({ ok: true, ticker, data: cached.data, cached: true });
  }

  try {
    console.log(`[fetch] ${ticker}`);
    const data = await yahooFinance.quoteSummary(ticker, {
      modules: [
        'financialData',
        'defaultKeyStatistics',
        'incomeStatementHistoryQuarterly',
        'cashflowStatementHistoryQuarterly',
        'balanceSheetHistoryQuarterly',
        'earningsTrend',
        'price',
      ],
    });
    cache.set(ticker, { data, fetchedAt: Date.now() });
    res.json({ ok: true, ticker, data });
  } catch (err) {
    const msg = err.message ?? String(err);
    const isRateLimit = msg.includes('Too Many Requests') || msg.includes('429');
    const isMissing   = msg.includes('No fundamentals') || msg.includes('not found');
    const status = isRateLimit ? 429 : isMissing ? 404 : 400;
    const friendly = isRateLimit
      ? 'Yahoo Finance rate limit hit — wait 30–60 seconds and try again'
      : msg;
    console.error(`[error] ${ticker}: ${msg}`);
    res.status(status).json({ ok: false, ticker, error: friendly });
  }
});

app.listen(PORT, () => {
  console.log(`Stock Style Analyzer → http://localhost:${PORT}`);
});
