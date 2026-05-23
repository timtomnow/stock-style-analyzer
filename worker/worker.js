// Cloudflare Worker: Yahoo Finance proxy for Stock Style Analyzer.
//
// Mirrors the GET /api/quote/:ticker endpoint of server.js so the static
// frontend on GitHub Pages can fetch the same shape without CORS issues.
//
// Deploy: `wrangler deploy` from this directory (see wrangler.toml).

const MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'incomeStatementHistoryQuarterly',
  'cashflowStatementHistoryQuarterly',
  'balanceSheetHistoryQuarterly',
  'earningsTrend',
  'price',
].join(',');

const TICKER_RE = /^[A-Z0-9.\-^=]+$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CACHE_TTL_S = 5 * 60;       // 5-minute response cache via Cache API
const CRUMB_TTL_MS = 30 * 60_000; // 30 minutes
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Per-isolate memo for Yahoo's crumb/cookie pair. Isolates are short-lived so
// staleness self-heals; we still refetch every CRUMB_TTL_MS as a guardrail.
let memoCrumb = null;

async function fetchCrumb() {
  if (memoCrumb && Date.now() - memoCrumb.at < CRUMB_TTL_MS) return memoCrumb;
  const fc = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } });
  const setCookie = fc.headers.get('set-cookie') || '';
  const cookie = setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`crumb request failed: ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb) throw new Error('empty crumb from Yahoo');
  memoCrumb = { crumb, cookie, at: Date.now() };
  return memoCrumb;
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

async function fetchQuoteSummary(ticker) {
  let { crumb, cookie } = await fetchCrumb();
  const build = (c) => `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${MODULES}&crumb=${encodeURIComponent(c)}`;

  let yres = await fetch(build(crumb), { headers: { 'User-Agent': UA, Cookie: cookie } });

  // Crumb may have rotated — drop the memo and retry once.
  if (yres.status === 401 || yres.status === 403) {
    memoCrumb = null;
    ({ crumb, cookie } = await fetchCrumb());
    yres = await fetch(build(crumb), { headers: { 'User-Agent': UA, Cookie: cookie } });
  }
  return yres;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/quote\/([^/]+)$/);
    if (!match) return jsonResponse({ ok: false, error: 'Not found' }, { status: 404 });

    const ticker = decodeURIComponent(match[1]).toUpperCase().trim();
    if (!TICKER_RE.test(ticker)) {
      return jsonResponse({ ok: false, error: 'Invalid ticker symbol' }, { status: 400 });
    }

    // Cache API lookup — keyed on the canonical URL so identical tickers share.
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.local/quote/${ticker}`, { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.json();
      return jsonResponse({ ...body, cached: true });
    }

    try {
      const yres = await fetchQuoteSummary(ticker);

      if (yres.status === 429) {
        return jsonResponse({
          ok: false, ticker,
          error: 'Yahoo Finance rate limit hit — wait 30–60 seconds and try again',
        }, { status: 429 });
      }
      if (yres.status === 404) {
        return jsonResponse({ ok: false, ticker, error: 'Ticker not found' }, { status: 404 });
      }
      if (!yres.ok) {
        return jsonResponse({ ok: false, ticker, error: `Yahoo Finance error ${yres.status}` }, { status: 400 });
      }

      const yjson = await yres.json();
      const data = yjson?.quoteSummary?.result?.[0];
      if (!data) {
        const desc = yjson?.quoteSummary?.error?.description || 'No data returned';
        return jsonResponse({ ok: false, ticker, error: desc }, { status: 404 });
      }

      const body = { ok: true, ticker, data };
      // Stash in edge cache for CACHE_TTL_S so repeat fetches across users hit cache.
      await cache.put(cacheKey, new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_S}` },
      }));
      return jsonResponse(body);
    } catch (err) {
      return jsonResponse({ ok: false, ticker, error: err.message || String(err) }, { status: 500 });
    }
  },
};
