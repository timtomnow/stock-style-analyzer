'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'stock_analyzer_v1';

// Maps sub-pages to their parent sidebar page for active highlighting
const SIDEBAR_MAP = {};

// Palette for multi-stock dots on the style box (cycles if > 8 stocks).
const STOCK_COLORS = [
  '#2563eb', '#16a34a', '#ca8a04', '#dc2626',
  '#7c3aed', '#0891b2', '#ea580c', '#db2777',
];

const SNAPSHOT_STALE_MS = 7 * 24 * 3600 * 1000;

function colorForIndex(i) { return STOCK_COLORS[i % STOCK_COLORS.length]; }

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
// In-memory only: 0 = TTM, N = shift YoY window N quarters into the past
let currentPeriod = 0;
// In-memory only: watchlist sort state (not persisted)
let watchlistSort = { col: 'net', dir: 'desc' };

// ═══════════════════════════════════════════════════════════════
// DATA SCHEMAS & DEFAULTS
// ═══════════════════════════════════════════════════════════════

function defaultData() {
  return {
    version: 1,
    stocks: [],   // saved/watchlisted stocks
    settings: {
      appName: 'Stock Style Analyzer',
      scoringConfig: defaultScoringConfig(),
    },
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
    // migrate: ensure every stock has a snapshot field (pre-Phase 6 entries have none)
    for (const s of state.data.stocks) {
      if (!('snapshot' in s)) s.snapshot = null;
    }
    // migrate: ensure scoringConfig exists, and fill in any missing factor keys
    if (!state.data.settings) state.data.settings = {};
    const defaultCfg = defaultScoringConfig();
    const cfg = state.data.settings.scoringConfig;
    if (!cfg || !cfg.weights || !cfg.enabled) {
      state.data.settings.scoringConfig = defaultCfg;
    } else {
      for (const k of Object.keys(defaultCfg.weights)) {
        if (cfg.weights[k] == null) cfg.weights[k] = defaultCfg.weights[k];
        if (cfg.enabled[k] == null) cfg.enabled[k] = defaultCfg.enabled[k];
      }
    }
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
// WATCHLIST SNAPSHOTS
// ═══════════════════════════════════════════════════════════════

function periodLabelFor(data, periodOffset) {
  if (!periodOffset) return 'TTM';
  const qtrs = data?.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
  const endDate = qtrs[periodOffset]?.endDate?.raw ?? qtrs[periodOffset]?.endDate;
  if (!endDate) return `Q-${periodOffset}`;
  const d = new Date(endDate);
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

function makeSnapshot(scores, periodOffset, cfg, data) {
  return {
    valueScore:  scores?.valueScore  ?? null,
    growthScore: scores?.growthScore ?? null,
    netScore:    scores?.netScore    ?? null,
    style:       scores?.style       ?? null,
    size:        scores?.size        ?? null,
    fetchedAt:   new Date().toISOString(),
    periodOffset: periodOffset || 0,
    periodLabel: periodLabelFor(data, periodOffset),
    scoringConfigUsed: deepClone(cfg),
  };
}

function isSnapshotStale(snapshot) {
  if (!snapshot?.fetchedAt) return false;
  return Date.now() - new Date(snapshot.fetchedAt).getTime() > SNAPSHOT_STALE_MS;
}

function sortStocks(stocks, col, dir) {
  const mult = dir === 'desc' ? -1 : 1;
  const getVal = s => {
    switch (col) {
      case 'ticker':    return s.ticker || '';
      case 'name':      return s.name || '';
      case 'style':     return s.snapshot?.style;
      case 'size':      return s.snapshot?.size;
      case 'value':     return s.snapshot?.valueScore;
      case 'growth':    return s.snapshot?.growthScore;
      case 'net':       return s.snapshot?.netScore;
      case 'period':    return s.snapshot?.periodLabel;
      case 'refreshed': return s.snapshot?.fetchedAt;
      default:          return 0;
    }
  };
  return [...stocks].sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;   // null/undefined always sorts to bottom
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });
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
  const colorByTicker = {};
  stocks.forEach((s, i) => { colorByTicker[s.ticker] = colorForIndex(i); });

  const scored = stocks
    .filter(s => s.snapshot?.netScore != null)
    .sort((a, b) => b.snapshot.netScore - a.snapshot.netScore);
  const topN = scored.slice(0, 5);

  const plotStocks = topN.map(s => ({
    ticker: s.ticker,
    scores: {
      netScore: s.snapshot.netScore,
      size: s.snapshot.size,
      style: s.snapshot.style,
    },
    color: colorByTicker[s.ticker],
  }));

  const compactRow = s => {
    const color = colorByTicker[s.ticker];
    const snap = s.snapshot;
    const netLabel = snap.netScore >= 0 ? `+${Math.round(snap.netScore)}` : `${Math.round(snap.netScore)}`;
    return `
      <tr class="watchlist-row" data-ticker="${esc(s.ticker)}"
          onmouseenter="highlightStyleBoxDot('${esc(s.ticker)}')"
          onmouseleave="resetStyleBoxDots()"
          onclick="if(event.target.closest('button'))return; lookupTicker('${esc(s.ticker)}')">
        <td class="font-mono" style="font-weight:600">
          <span class="ticker-swatch" style="background:${color}"></span>${esc(s.ticker)}
        </td>
        <td><span style="color:${color};font-weight:600">${esc(snap.style || '—')}</span></td>
        <td class="text-right font-mono">${esc(netLabel)}</td>
        <td class="nowrap text-right">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();lookupTicker('${esc(s.ticker)}')">Analyze</button>
        </td>
      </tr>`;
  };

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
          <div class="stat-label">Scored</div>
          <div class="stat-value">${scored.length}</div>
        </div>
      </div>

      ${stocks.length > 0 ? `
      <div class="card">
        <div class="card-title">Watchlist — Top ${topN.length || 5} by Net Score</div>
        ${renderStyleBox(plotStocks, { width: 160 })}
        <div class="table-wrap" style="margin-top:8px">
          <table>
            <thead><tr>
              <th>Ticker</th><th>Style</th><th class="text-right">Net</th><th></th>
            </tr></thead>
            <tbody>
              ${topN.length > 0
                ? topN.map(compactRow).join('')
                : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:14px">No scored stocks yet — open the Watchlist and refresh a row to populate scores.</td></tr>`}
            </tbody>
          </table>
          ${stocks.length > topN.length
            ? `<div class="form-hint" style="margin-top:8px;text-align:center"><a href="#" onclick="navigate('watchlist');return false;">View all ${stocks.length} →</a></div>`
            : ''}
        </div>
      </div>` : `
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
            <div class="step-body">10 fundamental factors are scored on a 0–100 scale.</div>
          </div>
          <div class="step-card">
            <div class="step-num">3</div>
            <div class="step-label">Plot the Style Box</div>
            <div class="step-body">See where the stock lands: Value, Blend, or Growth × Large/Mid/Small.</div>
          </div>
          <div class="step-card">
            <div class="step-num">4</div>
            <div class="step-label">Compare stocks</div>
            <div class="step-body">Save to your watchlist and plot multiple stocks together.</div>
          </div>
        </div>
      </div>`}
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
    currentPeriod = 0;
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

function buildPeriodOptions(data) {
  const opts = [{ offset: 0, label: 'TTM (current)' }];
  const qtrs = data?.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
  for (let i = 1; i < Math.min(qtrs.length, 5); i++) {
    const endDate = qtrs[i].endDate?.raw ?? qtrs[i].endDate;
    if (!endDate) continue;
    // Only offer offsets where at least 2 growth factors can be computed
    const probe = computeScores(data, state.data.settings.scoringConfig, { periodOffset: i });
    const growthCount = GROWTH_FACTORS.filter(f => probe.factors[f.key].score != null).length;
    if (growthCount < 2) continue;
    const d = new Date(endDate);
    const q = Math.floor(d.getMonth() / 3) + 1;
    opts.push({ offset: i, label: `Q${q} ${d.getFullYear()}` });
  }
  return opts;
}

function setPeriod(offset) {
  currentPeriod = parseInt(offset, 10) || 0;
  document.getElementById('lookup-result').innerHTML = renderQuoteResult(currentQuote);
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

// Renders one or more stock dots on the 3×3 style box.
// `stocks` is an array of { ticker, scores, color? }.
// Options: { width=240 }  — height tracks width (square).
function renderStyleBox(stocks, options = {}) {
  const W = options.width ?? 240;
  const H = W;
  const cellW = W / 3, cellH = H / 3;

  const COLUMNS = [
    { name: 'Value',  bg: '#fdf6e3' },
    { name: 'Blend',  bg: '#fafafa' },
    { name: 'Growth', bg: '#f0fdf4' },
  ];
  const ROWS = ['Large', 'Mid', 'Small'];

  const cellFont  = Math.max(8, Math.round(W * 11 / 240));
  const labelFont = Math.max(9, Math.round(W * 11 / 240));
  const R = options.dotRadius ?? Math.max(6, Math.round(W * 10 / 240));

  const cellRects = [];
  const cellLabels = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cellRects.push(`<rect x="${c * cellW}" y="${r * cellH}" width="${cellW}" height="${cellH}" fill="${COLUMNS[c].bg}"/>`);
      const cx = c * cellW + cellW / 2;
      const cy = r * cellH + cellH / 2;
      cellLabels.push(
        `<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="${cellFont}" fill="#a1a1aa">${ROWS[r]}</text>` +
        `<text x="${cx}" y="${cy + cellFont}" text-anchor="middle" font-size="${cellFont}" fill="#a1a1aa">${COLUMNS[c].name}</text>`
      );
    }
  }

  const gridLines = [];
  for (let i = 0; i <= 3; i++) {
    gridLines.push(`<line x1="${i * cellW}" y1="0" x2="${i * cellW}" y2="${H}" stroke="#d4d4d8" stroke-width="1"/>`);
    gridLines.push(`<line x1="0" y1="${i * cellH}" x2="${W}" y2="${i * cellH}" stroke="#d4d4d8" stroke-width="1"/>`);
  }

  const svgOpen = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;margin:0 auto;font-family:var(--font)"`;

  const valid = (stocks || []).filter(s => s && s.scores && s.scores.netScore != null);

  if (valid.length === 0) {
    return `
      <div class="style-box-wrap">
        ${svgOpen} role="img" aria-label="Style box — insufficient data">
          <g opacity="0.45">
            ${cellRects.join('')}
            ${gridLines.join('')}
            ${cellLabels.join('')}
          </g>
          <rect x="20" y="${H / 2 - 16}" width="${W - 40}" height="32" fill="#ffffff" stroke="#d4d4d8" stroke-width="1" rx="4"/>
          <text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-size="12" fill="#71717a" font-weight="600">Insufficient data</text>
        </svg>
      </div>`;
  }

  // Compute (x, y) and assigned color for each dot.
  const positions = valid.map((s, i) => {
    const { netScore, size, style } = s.scores;
    const xRaw = ((netScore + 100) / 200) * W;
    const x = Math.max(R + 2, Math.min(W - R - 2, xRaw));
    const y = size === 'large' ? cellH * 0.5
            : size === 'small' ? cellH * 2.5
            : cellH * 1.5;
    return {
      x, y,
      ticker: s.ticker,
      style,
      size,
      netScore,
      color: s.color || colorForIndex(i),
    };
  });

  // Cluster nearby dots and alternate label side (left/right) within each cluster.
  const sides = positions.map(() => 'right');
  const visited = new Set();
  for (let i = 0; i < positions.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [i];
    visited.add(i);
    for (let j = i + 1; j < positions.length; j++) {
      if (visited.has(j)) continue;
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.hypot(dx, dy) < R * 2) {
        cluster.push(j);
        visited.add(j);
      }
    }
    cluster.forEach((idx, k) => {
      sides[idx] = k % 2 === 0 ? 'right' : 'left';
    });
  }

  const dotsAndLabels = positions.map((p, i) => {
    // Fall back to opposite side if the cluster-assigned side would clip a box edge.
    const labelWidth = p.ticker.length * labelFont * 0.6 + 6;
    const fitsRight  = p.x + R + labelWidth <= W;
    const fitsLeft   = p.x - R - labelWidth >= 0;
    const side = sides[i] === 'right'
      ? (fitsRight ? 'right' : 'left')
      : (fitsLeft  ? 'left'  : 'right');
    const labelX = side === 'right' ? p.x + R + 4 : p.x - R - 4;
    const anchor = side === 'right' ? 'start' : 'end';
    const tip = `${p.ticker} — ${p.size}-cap ${p.style} (net ${p.netScore >= 0 ? '+' : ''}${Math.round(p.netScore)})`;
    return `
      <circle class="stylebox-dot" data-ticker="${esc(p.ticker)}" data-r="${R}" cx="${p.x}" cy="${p.y}" r="${R}" fill="${p.color}" stroke="#ffffff" stroke-width="2.5">
        <title>${esc(tip)}</title>
      </circle>
      <text class="stylebox-label" data-ticker="${esc(p.ticker)}" x="${labelX}" y="${p.y + 4}" text-anchor="${anchor}" font-size="${labelFont}" font-weight="700" fill="${p.color}" style="paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round">${esc(p.ticker)}</text>`;
  });

  const aria = valid.length === 1
    ? `Style box for ${valid[0].ticker}: ${valid[0].scores.size}-cap ${valid[0].scores.style}`
    : `Style box comparing ${valid.length} stocks`;

  return `
    <div class="style-box-wrap">
      ${svgOpen} role="img" aria-label="${esc(aria)}">
        ${cellRects.join('')}
        ${gridLines.join('')}
        ${cellLabels.join('')}
        ${dotsAndLabels.join('')}
      </svg>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// STYLE BOX HOVER HIGHLIGHTING (used by watchlist + dashboard rows)
// ═══════════════════════════════════════════════════════════════

function highlightStyleBoxDot(ticker) {
  document.querySelectorAll('.stylebox-dot').forEach(el => {
    if (el.dataset.ticker !== ticker) return;
    const baseR = parseFloat(el.dataset.r || el.getAttribute('r') || '10');
    el.setAttribute('r', baseR + 4);
    el.setAttribute('stroke-width', '3.5');
    el.parentNode.appendChild(el);
  });
  document.querySelectorAll('.stylebox-label').forEach(el => {
    if (el.dataset.ticker === ticker) el.parentNode.appendChild(el);
  });
}

function resetStyleBoxDots() {
  document.querySelectorAll('.stylebox-dot').forEach(el => {
    const baseR = el.dataset.r || '10';
    el.setAttribute('r', baseR);
    el.setAttribute('stroke-width', '2.5');
  });
}

function renderScores(scores, ticker) {
  if (!scores) {
    return `<p style="color:var(--muted);font-size:13px;padding:8px 0">Could not compute scores — data unavailable.</p>`;
  }

  const { valueScore, growthScore, netScore, style, size, factors } = scores;

  const valueCount  = VALUE_FACTORS.filter(f => factors[f.key].score != null).length;
  const growthCount = GROWTH_FACTORS.filter(f => factors[f.key].score != null).length;

  const warning = (valueCount < 3 || growthCount < 3)
    ? `<div class="score-warning">Warning: limited data (${valueCount}/5 value, ${growthCount}/5 growth factors) — scores may not be reliable.</div>`
    : '';

  const fmtFactor = (key, rawVal) => {
    if (rawVal == null) return '—';
    return ['yield', 'eps_fwd', 'eps_hist', 'rev', 'cf', 'bv'].includes(key)
      ? fmtPct(rawVal)
      : fmtNum(rawVal);
  };

  const STYLE_CSS = { Value: 'var(--warning)', Blend: 'var(--accent)', Growth: 'var(--success)', Unknown: 'var(--muted)' };
  const styleColor = STYLE_CSS[style] || 'var(--muted)';
  const netLabel   = netScore != null ? (netScore >= 0 ? `+${Math.round(netScore)}` : `${Math.round(netScore)}`) : '—';
  const sizeLabel  = { large: 'Large', mid: 'Mid', small: 'Small' }[size] || '—';

  const allFactors = [...VALUE_FACTORS, ...GROWTH_FACTORS];

  return `
    ${warning}
    ${renderStyleBox([{ ticker, scores }])}
    <div class="score-grid">
      <div class="score-card">
        <div class="score-card-label">Value Score</div>
        <div class="score-card-value">${valueScore != null ? Math.round(valueScore) : '—'}</div>
        ${valueScore != null ? `<div class="score-bar"><div class="score-bar-fill score-bar-value" style="width:${valueScore}%"></div></div>` : ''}
        <div class="score-card-hint">${valueCount}/5 factors</div>
      </div>
      <div class="score-card">
        <div class="score-card-label">Growth Score</div>
        <div class="score-card-value">${growthScore != null ? Math.round(growthScore) : '—'}</div>
        ${growthScore != null ? `<div class="score-bar"><div class="score-bar-fill score-bar-growth" style="width:${growthScore}%"></div></div>` : ''}
        <div class="score-card-hint">${growthCount}/5 factors</div>
      </div>
      <div class="score-card">
        <div class="score-card-label">Style</div>
        <div class="score-card-value" style="color:${styleColor}">${esc(style)}</div>
        <div class="score-card-hint">${esc(sizeLabel)}-cap · Net ${esc(netLabel)}</div>
      </div>
    </div>

    <div class="card-title" style="margin-top:18px">Factor Breakdown</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Factor</th><th>Type</th>
          <th class="text-right">Raw Value</th>
          <th class="text-right">Weight</th>
          <th class="text-right">Score</th>
        </tr></thead>
        <tbody>
          ${allFactors.map(({ key, label }) => {
            const f = factors[key];
            const isValue  = VALUE_FACTORS.some(v => v.key === key);
            const typeLabel = isValue ? 'Value' : 'Growth';
            const disabled  = f.enabled === false || f.weight === 0;
            const scoreDisp = disabled ? 'off' : (f.score != null ? Math.round(f.score) : 'N/A');
            const scoreClass = disabled
              ? 'text-muted'
              : f.score != null
                ? (f.score >= 65 ? 'text-positive' : f.score <= 35 ? 'text-negative' : '')
                : 'text-muted';
            const rowStyle = disabled ? 'opacity:0.45' : '';
            const weightDisp = f.weight != null ? fmtNum(f.weight, f.weight % 1 === 0 ? 0 : 2) : '—';
            return `<tr style="${rowStyle}">
              <td>${esc(label)}</td>
              <td class="text-muted" style="font-size:12px">${esc(typeLabel)}</td>
              <td class="text-right font-mono">${esc(fmtFactor(key, f.raw))}</td>
              <td class="text-right font-mono text-muted">${esc(weightDisp)}×</td>
              <td class="text-right font-mono ${scoreClass}">${esc(String(scoreDisp))}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
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
  const periodOpts  = buildPeriodOptions(d);
  const selectedOpt = periodOpts.find(o => o.offset === currentPeriod) || periodOpts[0];
  // If the previously-selected offset is no longer in the list (e.g. after a re-fetch),
  // snap back to TTM.
  if (selectedOpt.offset !== currentPeriod) currentPeriod = selectedOpt.offset;

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

      <div class="period-selector">
        <label for="period-select">Analyze as of</label>
        <select id="period-select" onchange="setPeriod(this.value)">
          ${periodOpts.map(o =>
            `<option value="${o.offset}"${o.offset === currentPeriod ? ' selected' : ''}>${esc(o.label)}</option>`
          ).join('')}
        </select>
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

      <div class="card-title" style="margin-top:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>Style Scores</span>
        ${currentPeriod > 0 ? `<span class="badge neutral">${esc(selectedOpt.label)}</span>` : ''}
        ${!isDefaultScoringConfig(state.data.settings.scoringConfig)
          ? `<span class="badge" style="cursor:pointer" onclick="navigate('settings')" title="Click to edit weights">Custom weights active</span>`
          : ''}
      </div>
      ${currentPeriod > 0 ? `
        <div class="score-warning">
          Showing growth factors as of <strong>${esc(selectedOpt.label)}</strong>.
          Valuation ratios (P/E, P/B, P/S, P/CF, Div. Yield, EPS Fwd) reflect the
          current snapshot only — Yahoo Finance does not return historical multiples,
          so they are shown as N/A and excluded from scoring.
        </div>` : ''}
      ${renderScores(
        computeScores(q.data, state.data.settings.scoringConfig, { periodOffset: currentPeriod }),
        q.ticker
      )}
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
  const cfg = state.data.settings.scoringConfig;
  const scores = computeScores(data, cfg, { periodOffset: currentPeriod });
  state.data.stocks.push({
    ticker,
    name,
    addedAt: new Date().toISOString(),
    snapshot: makeSnapshot(scores, currentPeriod, cfg, data),
  });
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

async function refreshWatchlistStock(ticker) {
  const stock = state.data.stocks.find(s => s.ticker === ticker);
  if (!stock) return;
  showToast(`Refreshing ${ticker}…`);
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Fetch failed');
    const cfg = state.data.settings.scoringConfig;
    const scores = computeScores(json.data, cfg, { periodOffset: 0 });
    stock.name = json.data.price?.longName || json.data.price?.shortName || ticker;
    stock.snapshot = makeSnapshot(scores, 0, cfg, json.data);
    saveData();
    navigate(state.page);
    showToast(`${ticker} refreshed`, 'success');
  } catch (err) {
    showToast(`${ticker}: ${err.message}`, 'error');
  }
}

function setWatchlistSort(col) {
  if (watchlistSort.col === col) {
    watchlistSort.dir = watchlistSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    watchlistSort.col = col;
    watchlistSort.dir = ['ticker', 'name', 'style', 'size', 'period'].includes(col) ? 'asc' : 'desc';
  }
  navigate('watchlist');
}

// ═══════════════════════════════════════════════════════════════
// WATCHLIST PAGE
// ═══════════════════════════════════════════════════════════════

function renderWatchlist() {
  const { stocks } = state.data;

  if (stocks.length === 0) {
    return `
      <div class="page">
        <div class="page-header">
          <div>
            <div class="page-title">Watchlist</div>
            <div class="page-subtitle">0 stocks saved</div>
          </div>
          <button class="btn btn-primary" onclick="navigate('lookup')">+ Add Stock</button>
        </div>
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">No stocks saved yet</div>
            <div class="empty-state-body">Look up a stock and click "Add to Watchlist".</div>
            <button class="btn btn-primary" onclick="navigate('lookup')">Look Up Stock</button>
          </div>
        </div>
      </div>`;
  }

  // Color is stable per ticker (based on insertion order), independent of sort.
  const colorByTicker = {};
  stocks.forEach((s, i) => { colorByTicker[s.ticker] = colorForIndex(i); });

  const sorted = sortStocks(stocks, watchlistSort.col, watchlistSort.dir);

  const plotStocks = stocks
    .filter(s => s.snapshot?.netScore != null)
    .map(s => ({
      ticker: s.ticker,
      scores: {
        netScore: s.snapshot.netScore,
        size: s.snapshot.size,
        style: s.snapshot.style,
      },
      color: colorByTicker[s.ticker],
    }));

  const arrow = (col) =>
    watchlistSort.col === col ? (watchlistSort.dir === 'desc' ? ' ↓' : ' ↑') : '';
  const sortTh = (col, label, extraClass = '') =>
    `<th class="sort-th ${extraClass}" onclick="setWatchlistSort('${col}')">${esc(label)}<span class="sort-arrow">${arrow(col)}</span></th>`;

  const sizeLabelOf = size => ({ large: 'Large', mid: 'Mid', small: 'Small' }[size] || '—');

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Watchlist</div>
          <div class="page-subtitle">${stocks.length} stock${stocks.length !== 1 ? 's' : ''} saved · hover a row to highlight its dot, click to analyze</div>
        </div>
        <button class="btn btn-primary" onclick="navigate('lookup')">+ Add Stock</button>
      </div>

      <div class="card">
        <div class="card-title">Style Box Comparison</div>
        ${renderStyleBox(plotStocks)}
        <div class="form-hint" style="text-align:center;margin-top:4px;max-width:520px;margin-left:auto;margin-right:auto">
          Each stock's position uses the scoring weights that were active when it was last refreshed — not your current settings. Refresh a row to re-score with the current weights.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Stocks</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${sortTh('ticker', 'Ticker')}
              ${sortTh('name',   'Name')}
              ${sortTh('style',  'Style')}
              ${sortTh('size',   'Size')}
              ${sortTh('value',  'Value',  'text-right')}
              ${sortTh('growth', 'Growth', 'text-right')}
              ${sortTh('net',    'Net',    'text-right')}
              ${sortTh('period', 'Period')}
              ${sortTh('refreshed', 'Refreshed')}
              <th class="text-right">Actions</th>
            </tr></thead>
            <tbody>
              ${sorted.map(s => {
                const snap = s.snapshot;
                const color = colorByTicker[s.ticker];
                const stale = isSnapshotStale(snap);
                const styleHtml = snap?.style
                  ? `<span style="color:${color};font-weight:600">${esc(snap.style)}</span>`
                  : `<span class="text-muted">—</span>`;
                const sizeHtml = snap?.size
                  ? esc(sizeLabelOf(snap.size))
                  : `<span class="text-muted">—</span>`;
                const numCell = v => v != null ? `<span class="font-mono">${Math.round(v)}</span>` : `<span class="text-muted">—</span>`;
                const netLabel = snap?.netScore != null
                  ? (snap.netScore >= 0 ? `+${Math.round(snap.netScore)}` : `${Math.round(snap.netScore)}`)
                  : null;
                const periodHtml = snap?.periodLabel
                  ? (snap.periodLabel === 'TTM'
                      ? `<span class="badge neutral">TTM</span>`
                      : `<span class="badge">${esc(snap.periodLabel)}</span>`)
                  : `<span class="text-muted">—</span>`;
                const refreshedHtml = snap?.fetchedAt
                  ? (stale
                      ? `<span class="text-muted" title="Snapshot is over 7 days old">${fmtDate(snap.fetchedAt)} <span class="badge-stale">stale</span></span>`
                      : `<span class="text-muted">${fmtDate(snap.fetchedAt)}</span>`)
                  : `<span class="text-muted">—</span>`;
                const refreshLabel = snap ? 'Refresh' : 'Score';
                return `
                  <tr class="watchlist-row" data-ticker="${esc(s.ticker)}"
                      onmouseenter="highlightStyleBoxDot('${esc(s.ticker)}')"
                      onmouseleave="resetStyleBoxDots()"
                      onclick="if(event.target.closest('button'))return; lookupTicker('${esc(s.ticker)}')">
                    <td class="font-mono" style="font-weight:600">
                      <span class="ticker-swatch" style="background:${color}"></span>${esc(s.ticker)}
                    </td>
                    <td>${esc(s.name || '—')}</td>
                    <td>${styleHtml}</td>
                    <td>${sizeHtml}</td>
                    <td class="text-right">${numCell(snap?.valueScore)}</td>
                    <td class="text-right">${numCell(snap?.growthScore)}</td>
                    <td class="text-right">${netLabel != null ? `<span class="font-mono">${esc(netLabel)}</span>` : `<span class="text-muted">—</span>`}</td>
                    <td>${periodHtml}</td>
                    <td>${refreshedHtml}</td>
                    <td class="nowrap text-right">
                      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();refreshWatchlistStock('${esc(s.ticker)}')">${refreshLabel}</button>
                      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();removeFromWatchlist('${esc(s.ticker)}')">Remove</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

function renderSettings() {
  const { settings } = state.data;
  const cfg = settings.scoringConfig;
  const isCustom = !isDefaultScoringConfig(cfg);

  const factorRow = ({ key, label }, type) => {
    const w = cfg.weights[key];
    const en = cfg.enabled[key];
    return `
      <div class="weight-row ${en ? '' : 'weight-row-off'}">
        <label class="weight-toggle">
          <input type="checkbox" ${en ? 'checked' : ''} onchange="toggleFactor('${key}', this.checked)">
        </label>
        <div class="weight-meta">
          <div class="weight-label">${esc(label)}</div>
          <div class="weight-type">${type}</div>
        </div>
        <input type="range" min="0" max="3" step="0.25" value="${w}"
          ${en ? '' : 'disabled'}
          class="weight-slider"
          oninput="setFactorWeight('${key}', this.value)">
        <div class="weight-value font-mono" id="weight-readout-${key}">${fmtNum(w, w % 1 === 0 ? 0 : 2)}×</div>
      </div>`;
  };

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Settings</div>
          <div class="page-subtitle">App preferences</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span>Scoring Weights</span>
          ${isCustom ? `<span class="badge">Custom</span>` : `<span class="badge neutral">Defaults</span>`}
        </div>
        <div class="form-hint" style="margin-bottom:14px">
          Each factor contributes weight × score to its Value or Growth average.
          Set weight to 0 or uncheck to exclude a factor.
        </div>

        <div class="weight-section-label">Value Factors</div>
        ${VALUE_FACTORS.map(f => factorRow(f, 'Value')).join('')}

        <div class="weight-section-label" style="margin-top:14px">Growth Factors</div>
        ${GROWTH_FACTORS.map(f => factorRow(f, 'Growth')).join('')}

        <div style="margin-top:16px">
          <button class="btn btn-secondary" onclick="resetScoringConfig()">Reset to Defaults</button>
        </div>
      </div>

      <div class="card mt-4">
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

function setFactorWeight(key, val) {
  const w = parseFloat(val);
  state.data.settings.scoringConfig.weights[key] = w;
  saveData();
  const readout = document.getElementById(`weight-readout-${key}`);
  if (readout) readout.textContent = `${fmtNum(w, w % 1 === 0 ? 0 : 2)}×`;
}

function toggleFactor(key, on) {
  state.data.settings.scoringConfig.enabled[key] = on;
  saveData();
  navigate('settings');
}

function resetScoringConfig() {
  state.data.settings.scoringConfig = defaultScoringConfig();
  saveData();
  navigate('settings');
  showToast('Scoring weights reset to defaults', 'success');
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
