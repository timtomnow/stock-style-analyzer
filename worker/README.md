# Cloudflare Worker — Yahoo Finance Proxy

Mirrors the local Node proxy (`server.js`) so the static frontend hosted on GitHub Pages can fetch quote data without hitting CORS.

## Endpoint

```
GET /api/quote/:ticker
```

Returns the same `{ ok, ticker, data, cached? }` shape as the local Express server.

## Deploy

```bash
npm install -g wrangler            # one-time
cd worker
wrangler login                     # opens browser → authorize your CF account
wrangler deploy                    # publishes to https://stock-style-api.<your-subdomain>.workers.dev
```

After deploy, wrangler prints the live URL. Paste that URL into `API_BASE` near the top of `../app.js` (no trailing slash), then commit and push.

## How it works

- Fetches Yahoo's cookie/crumb pair on first request, memoizes per-isolate, retries once on 401/403 if the crumb rotates.
- 5-minute response cache via Cloudflare's `caches.default` keyed on ticker.
- CORS-open (`Access-Control-Allow-Origin: *`) so any origin can call it — fine for a personal tool, but if you want to lock it down replace `*` with your Pages origin.
