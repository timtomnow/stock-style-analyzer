'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'stock_analyzer_v1';

// Maps sub-pages to their parent sidebar page for active highlighting
const SIDEBAR_MAP = {};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  data: null,        // persisted to localStorage
  page: 'dashboard',
  params: {},
};

// In-memory only: last fetched quote result (not persisted)
let currentQuote = null;

// ═══════════════════════════════════════════════════════════════
// DATA SCHEMAS & DEFAULTS
// ═══════════════════════════════════════════════════════════════

function defaultData() {
  return {
    version: 1,
    stocks: [],   // saved/watchlisted stocks
    settings: { appName: 'Stock Style Analyzer' },
  };
}

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.data = raw ? JSON.parse(raw) : defaultData();
    // migrate: ensure stocks array exists
    if (!state.data.stocks) state.data.stocks = [];
  } catch (e) {
    state.data = defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `stock-analyzer-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data exported');
}

function triggerImport() {
  const input = Object.assign(document.createElement('input'), {
    type: 'file', accept: '.json',
  });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        state.data = JSON.parse(ev.target.result);
        saveData();
        navigate('dashboard');
        showToast('Data imported', 'success');
      } catch {
        showToast('Invalid file — could not import', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function fmtDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(decimals) + '%';
}

function fmtMktCap(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString();
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════

function showModal(title, bodyHtml, onSave, saveLabel = 'Save') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save">${esc(saveLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-save').onclick = () => { if (onSave()) hideModal(); };
}

function showConfirm(title, msg, onConfirm, confirmLabel = 'Delete') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body"><p style="color:var(--muted);font-size:14px;">${esc(msg)}</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm">${esc(confirmLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-confirm').onclick = () => { onConfirm(); hideModal(); };
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').classList.remove('modal-wide');
}

async function showHelpModal(tab = 'readme') {
  const render = md => typeof marked !== 'undefined'
    ? marked.parse(md)
    : `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;
  const errHtml = '<p style="color:var(--danger)">Could not load documentation. Help requires the app to be served over HTTP.</p><p>Run <code>node server.js</code> and open <a href="http://localhost:3000" target="_blank">http://localhost:3000</a></p>';

  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Help &amp; Documentation</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab-btn${tab === 'readme' ? ' active' : ''}" onclick="switchHelpTab('readme')">User Guide</button>
      <button class="help-tab-btn${tab === 'claude' ? ' active' : ''}" onclick="switchHelpTab('claude')">Developer Guide</button>
    </div>
    <div class="help-content" id="help-readme" ${tab !== 'readme' ? 'style="display:none"' : ''}>
      <p style="color:var(--muted)">Loading…</p>
    </div>
    <div class="help-content" id="help-claude" ${tab !== 'claude' ? 'style="display:none"' : ''}>
      <p style="color:var(--muted)">Loading…</p>
    </div>`;
  document.getElementById('modal').classList.add('modal-wide');
  document.getElementById('modal-overlay').classList.add('open');

  const load = async (url, elId) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      document.getElementById(elId).innerHTML = render(await res.text());
    } catch {
      document.getElementById(elId).innerHTML = errHtml;
    }
  };

  load('./README.md', 'help-readme');
  load('./CLAUDE.md', 'help-claude');
}

function switchHelpTab(tab) {
  document.getElementById('help-readme').style.display = tab === 'readme' ? '' : 'none';
  document.getElementById('help-claude').style.display = tab === 'claude' ? '' : 'none';
  document.querySelectorAll('.help-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'readme') || (i === 1 && tab === 'claude'));
  });
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') hideModal();
});

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigate(page, params = {}) {
  state.page = page;
  state.params = params;

  const activeNav = SIDEBAR_MAP[page] ?? page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === activeNav));

  const main = document.getElementById('main');
  switch (page) {
    case 'dashboard': main.innerHTML = renderDashboard(); break;
    case 'lookup':    main.innerHTML = renderLookup();    break;
    case 'watchlist': main.innerHTML = renderWatchlist(); break;
    case 'settings':  main.innerHTML = renderSettings();  break;
    default:          main.innerHTML = renderDashboard();
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
  const { stocks } = state.data;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Dashboard</div>
          <div class="page-subtitle">Stock style analysis — Value, Blend, and Growth</div>
        </div>
        <button class="btn btn-primary" onclick="navigate('lookup')">Look Up Stock</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Watchlist</div>
          <div class="stat-value">${stocks.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" style="font-size:15px;color:var(--success)">Phase 1</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">How it works</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:4px;">
          <div class="step-card">
            <div class="step-num">1</div>
            <div class="step-label">Look up a ticker</div>
            <div class="step-body">Enter any stock symbol to fetch fundamentals from Yahoo Finance.</div>
          </div>
          <div class="step-card">
            <div class="step-num">2</div>
            <div class="step-label">Score Value &amp; Growth</div>
            <div class="step-body">10 fundamental factors are scored on a 0–100 scale (Phase 2).</div>
          </div>
          <div class="step-card">
            <div class="step-num">3</div>
            <div class="step-label">Plot the Style Box</div>
            <div class="step-body">See where the stock lands: Value, Blend, or Growth × Large/Mid/Small (Phase 3).</div>
          </div>
          <div class="step-card">
            <div class="step-num">4</div>
            <div class="step-label">Compare stocks</div>
            <div class="step-body">Save stocks to your watchlist and plot them together (Phase 6).</div>
          </div>
        </div>
      </div>

      ${stocks.length > 0 ? `
      <div class="card">
        <div class="card-title">Watchlist</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Ticker</th><th>Name</th><th>Added</th><th></th>
            </tr></thead>
            <tbody>
              ${stocks.map(s => `
                <tr>
                  <td class="font-mono" style="font-weight:600">${esc(s.ticker)}</td>
                  <td>${esc(s.name || '—')}</td>
                  <td class="text-muted">${fmtDate(s.addedAt)}</td>
                  <td class="nowrap text-right">
                    <button class="btn btn-ghost btn-sm" onclick="lookupTicker('${esc(s.ticker)}')">Analyze</button>
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeFromWatchlist('${esc(s.ticker)}')">Remove</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// STOCK LOOKUP
// ═══════════════════════════════════════════════════════════════

function renderLookup() {
  const q = currentQuote;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Stock Lookup</div>
          <div class="page-subtitle">Fetch fundamentals for any ticker</div>
        </div>
      </div>

      <div class="card">
        <div class="lookup-row">
          <input type="text" id="ticker-input" placeholder="e.g. AAPL, MSFT, WMT"
            value="${q ? esc(q.ticker) : ''}"
            style="max-width:260px;text-transform:uppercase"
            onkeydown="if(event.key==='Enter')fetchTicker()">
          <button class="btn btn-primary" id="fetch-btn" onclick="fetchTicker()">Fetch</button>
        </div>
      </div>

      <div id="lookup-result">
        ${q ? renderQuoteResult(q) : `
          <div class="card" style="margin-top:16px">
            <div class="empty-state">
              <div class="empty-state-icon">📈</div>
              <div class="empty-state-title">Enter a ticker above</div>
              <div class="empty-state-body">Data is fetched from Yahoo Finance via the local server.</div>
            </div>
          </div>`}
      </div>
    </div>`;
}

async function fetchTicker() {
  const input = document.getElementById('ticker-input');
  const ticker = (input?.value ?? '').trim().toUpperCase();
  if (!ticker) { showToast('Enter a ticker symbol', 'error'); return; }

  const btn = document.getElementById('fetch-btn');
  const resultEl = document.getElementById('lookup-result');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  resultEl.innerHTML = `<div class="card" style="margin-top:16px"><p style="color:var(--muted);padding:20px 0;text-align:center">Loading ${esc(ticker)}…</p></div>`;

  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    currentQuote = { ticker: json.ticker, data: json.data, fetchedAt: new Date().toISOString() };
    resultEl.innerHTML = renderQuoteResult(currentQuote);
  } catch (err) {
    currentQuote = null;
    resultEl.innerHTML = `<div class="card" style="margin-top:16px"><p style="color:var(--danger);padding:12px 0">${esc(err.message)}</p></div>`;
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch';
  }
}

// Called from dashboard watchlist to jump to lookup with a pre-loaded ticker
function lookupTicker(ticker) {
  navigate('lookup');
  // Give the DOM a tick to render, then simulate a fetch
  setTimeout(() => {
    const input = document.getElementById('ticker-input');
    if (input) { input.value = ticker; fetchTicker(); }
  }, 0);
}

function renderQuoteResult(q) {
  const d = q.data;
  const price = d.price || {};
  const fd = d.financialData || {};
  const ks = d.defaultKeyStatistics || {};

  const name = price.longName || price.shortName || q.ticker;
  const cur  = price.currency || 'USD';
  const mktCap = price.marketCap?.raw ?? price.marketCap;
  const currentPrice = price.regularMarketPrice?.raw ?? price.regularMarketPrice;

  // Key data points for the debug panel
  const rows = [
    ['Price',           currentPrice != null ? `${cur} ${fmtNum(currentPrice)}` : '—'],
    ['Market Cap',      fmtMktCap(mktCap)],
    ['Trailing P/E',    fmtNum(ks.trailingPE?.raw ?? ks.trailingPE)],
    ['Forward P/E',     fmtNum(ks.forwardPE?.raw ?? ks.forwardPE)],
    ['P/B Ratio',       fmtNum(ks.priceToBook?.raw ?? ks.priceToBook)],
    ['P/S (TTM)',       fmtNum(ks.priceToSalesTrailing12Months?.raw ?? ks.priceToSalesTrailing12Months)],
    ['EV/EBITDA',       fmtNum(ks.enterpriseToEbitda?.raw ?? ks.enterpriseToEbitda)],
    ['Revenue Growth',  fmtPct(fd.revenueGrowth?.raw ?? fd.revenueGrowth)],
    ['Earnings Growth', fmtPct(fd.earningsGrowth?.raw ?? fd.earningsGrowth)],
    ['Return on Equity',fmtPct(fd.returnOnEquity?.raw ?? fd.returnOnEquity)],
    ['Free CF (TTM)',   fmtMktCap(fd.freeCashflow?.raw ?? fd.freeCashflow)],
    ['Dividend Yield',  fmtPct(fd.dividendYield?.raw ?? fd.dividendYield)],
    ['Beta',            fmtNum(ks.beta?.raw ?? ks.beta)],
  ];

  const inWatchlist = state.data.stocks.some(s => s.ticker === q.ticker);

  return `
    <div class="card" style="margin-top:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
        <div>
          <div style="font-size:20px;font-weight:700">${esc(q.ticker)}</div>
          <div style="color:var(--muted);font-size:13px">${esc(name)}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:3px">Fetched ${fmtDate(q.fetchedAt)}</div>
        </div>
        ${inWatchlist
          ? `<button class="btn btn-secondary" onclick="removeFromWatchlist('${esc(q.ticker)}')">Remove from Watchlist</button>`
          : `<button class="btn btn-primary" onclick="addToWatchlist()">+ Add to Watchlist</button>`}
      </div>

      <div class="card-title">Key Fundamentals</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th class="text-right">Value</th></tr></thead>
          <tbody>
            ${rows.map(([label, val]) => `
              <tr>
                <td>${esc(label)}</td>
                <td class="text-right font-mono">${esc(val)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card-title" style="margin-top:20px">Scoring (Phase 2)</div>
      <div style="color:var(--muted);font-size:13px;padding:12px 0">
        Value Score and Growth Score will be computed here in Phase 2.
        Style box visualization will follow in Phase 3.
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Raw API Response (debug)</div>
      <pre class="debug-pre">${esc(JSON.stringify(q.data, null, 2))}</pre>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// WATCHLIST ACTIONS
// ═══════════════════════════════════════════════════════════════

function addToWatchlist() {
  if (!currentQuote) return;
  const { ticker, data } = currentQuote;
  if (state.data.stocks.some(s => s.ticker === ticker)) {
    showToast(`${ticker} already in watchlist`);
    return;
  }
  const name = data.price?.longName || data.price?.shortName || ticker;
  state.data.stocks.push({ ticker, name, addedAt: new Date().toISOString() });
  saveData();
  // Re-render just the result section to update the button
  document.getElementById('lookup-result').innerHTML = renderQuoteResult(currentQuote);
  showToast(`${ticker} added to watchlist`, 'success');
}

function removeFromWatchlist(ticker) {
  state.data.stocks = state.data.stocks.filter(s => s.ticker !== ticker);
  saveData();
  if (state.page === 'lookup' && currentQuote?.ticker === ticker) {
    document.getElementById('lookup-result').innerHTML = renderQuoteResult(currentQuote);
  } else {
    navigate(state.page);
  }
  showToast(`${ticker} removed from watchlist`);
}

// ═══════════════════════════════════════════════════════════════
// WATCHLIST PAGE
// ═══════════════════════════════════════════════════════════════

function renderWatchlist() {
  const { stocks } = state.data;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Watchlist</div>
          <div class="page-subtitle">${stocks.length} stock${stocks.length !== 1 ? 's' : ''} saved</div>
        </div>
        <button class="btn btn-primary" onclick="navigate('lookup')">+ Add Stock</button>
      </div>

      <div class="card">
        ${stocks.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No stocks saved yet</div>
            <div class="empty-state-body">Look up a stock and click "Add to Watchlist".</div>
            <button class="btn btn-primary" onclick="navigate('lookup')">Look Up Stock</button>
          </div>` : `
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Ticker</th><th>Name</th><th>Added</th><th></th>
              </tr></thead>
              <tbody>
                ${stocks.map(s => `
                  <tr>
                    <td class="font-mono" style="font-weight:600">${esc(s.ticker)}</td>
                    <td>${esc(s.name || '—')}</td>
                    <td class="text-muted">${fmtDate(s.addedAt)}</td>
                    <td class="nowrap text-right">
                      <button class="btn btn-ghost btn-sm" onclick="lookupTicker('${esc(s.ticker)}')">Analyze</button>
                      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeFromWatchlist('${esc(s.ticker)}')">Remove</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

function renderSettings() {
  const { settings } = state.data;
  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Settings</div>
          <div class="page-subtitle">App preferences</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">General</div>
        <div class="form-group">
          <label>App Name</label>
          <input type="text" id="set-appname" value="${esc(settings.appName ?? 'Stock Style Analyzer')}"
            style="max-width:320px" oninput="saveSettingAppName(this.value)">
          <div class="form-hint">Displayed in the sidebar logo.</div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-title">Data</div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="exportData()">Export Watchlist (JSON)</button>
          <button class="btn btn-secondary" onclick="triggerImport()">Import Watchlist (JSON)</button>
        </div>
        <div class="form-hint mt-2">Export regularly as a backup. Importing replaces all current data.</div>
      </div>
    </div>`;
}

function saveSettingAppName(val) {
  state.data.settings.appName = val;
  saveData();
  const logo = document.querySelector('.sidebar-logo span');
  if (logo) logo.textContent = val || 'Stock Style Analyzer';
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function buildSidebar() {
  const nav = [
    { page: 'dashboard', icon: '⊞',  label: 'Dashboard' },
    { page: 'lookup',    icon: '🔍', label: 'Stock Lookup' },
    { page: 'watchlist', icon: '★',  label: 'Watchlist'  },
    { page: 'settings',  icon: '⚙',  label: 'Settings'   },
  ];
  const activeNav = SIDEBAR_MAP[state.page] ?? state.page;
  const appName = state.data?.settings?.appName ?? 'Stock Style Analyzer';

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <span>${esc(appName)}</span>
      <button class="help-btn" onclick="showHelpModal()" title="Help &amp; Documentation">?</button>
    </div>
    <nav class="sidebar-nav">
      ${nav.map(({ page, icon, label }) => `
        <a class="nav-item${activeNav === page ? ' active' : ''}" data-page="${page}" onclick="navigate('${page}')">
          <span class="nav-icon">${icon}</span>${label}
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-secondary btn-sm btn-full" onclick="exportData()">Export Data</button>
      <button class="btn btn-secondary btn-sm btn-full" onclick="triggerImport()">Import Data</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  buildSidebar();
  navigate('dashboard');
});
