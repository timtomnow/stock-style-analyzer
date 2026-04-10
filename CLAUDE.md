# AppName — Codebase Guide for Claude

This is a self-contained, single-page app template. No framework, no build step, no npm. Four files: `index.html`, `styles.css`, `app.js`, `README.md`. Runs by opening `index.html` in any browser. marked.js loaded from CDN (internet required for help modal). Data persisted to `localStorage`.

---

## File Map

| File | Purpose |
|---|---|
| `index.html` | Shell. Loads marked.js CDN, `styles.css`, `app.js`. Contains `#app`, `#sidebar`, `#main`, `#modal-overlay`, `#toast-container`. |
| `styles.css` | Full design system. CSS variables in `:root`. No external dependencies. |
| `app.js` | Everything — state, data, all page renders, modals, routing, help modal. |
| `README.md` | End-user instructions (Markdown). |

---

## Architecture

Single-page app with manual routing. No framework. Pages are rendered by functions that return HTML strings assigned to `document.getElementById('main').innerHTML`.

### State

```js
const state = {
  data: null,        // all persisted data, mirrors localStorage
  page: 'dashboard',
  params: {},        // current page params (e.g. { id: 'some-id' })
};
```

`state.data` is loaded from `localStorage` on init and saved (`saveData()`) after every mutation.

### Navigation

```js
navigate(page, params = {})
```

Sets `state.page` / `state.params`, updates sidebar active class, calls the appropriate render function, sets `#main.innerHTML`.

Sub-pages without their own sidebar entry are mapped in `SIDEBAR_MAP` to their parent page for active highlighting.

---

## Data Model

All data lives in `state.data` and is saved as a single JSON blob to `localStorage` under `STORAGE_KEY`.

### Top-level shape

```js
{
  version: 1,
  items: Item[],
  settings: { appName: 'AppName' },
}
```

### Item

```js
{
  id,          // uuid string
  name,        // string
  description, // string
  category,    // string — from ITEM_CATEGORIES constant
  value,       // number
  createdAt,   // ISO date string
}
```

---

## UI Patterns

### Modals

`showModal(title, bodyHtml, onSave, saveLabel)` — injects HTML into `#modal`, adds class `open` to `#modal-overlay`. `onSave` must return `true` to close, `false` to keep open (for validation).

`showConfirm(title, msg, onConfirm, confirmLabel)` — destructive action variant.

`hideModal()` — removes `open` class. Also triggered by clicking the overlay backdrop.

All modal form fields use plain DOM reads (`document.getElementById(...).value`) inside the `onSave` callback.

### Toasts

`showToast(msg, type)` — type is `''` (dark), `'success'` (green), or `'error'` (red). Auto-removes after 3.2s.

### HTML Escaping

`esc(str)` escapes `& < > "` in all user-supplied strings interpolated into HTML templates. Use it everywhere user data appears in template literals.

### Help Modal

`showHelpModal(tab)` — async. Opens a wide modal (`modal-wide` class, 760px) with two tabs: **User Guide** and **Developer Guide**. Fetches `README.md` and `CLAUDE.md` at runtime via `fetch()` and renders them with `marked.parse()`. Falls back to `<pre>` if marked is unavailable. Shows an actionable error if the app is opened via `file://` instead of HTTP.

`switchHelpTab(tab)` — toggles visibility of `#help-readme` / `#help-claude` divs and updates `.active` on tab buttons.

`hideModal()` removes `modal-wide` in addition to closing, so normal modals are unaffected.

The `?` button lives in the `.sidebar-logo` div (flexbox layout), rendered by `buildSidebar()`.

---

## Adding a New Page

1. Write a `renderFoo()` function returning an HTML string.
2. Add a `case 'foo':` in the `navigate()` switch.
3. Add a nav item to the `nav` array in `buildSidebar()` if it needs a sidebar entry.
4. If it's a sub-page of an existing section, add it to `SIDEBAR_MAP`.

## Adding a New Field to a Data Model

1. Add the field to the relevant `default*()` function so new records get it.
2. Update the modal form (add input, read it in `onSave`).
3. Update display logic as needed.
4. Existing records without the field will get `undefined` — use `?? defaultValue` defensively.

---

## Key Constants

```js
STORAGE_KEY = 'app_v1'
ITEM_CATEGORIES  // array of category name strings
SIDEBAR_MAP      // maps sub-page names to parent sidebar page names
```

---

## Customising This Template

| Goal | What to change |
|---|---|
| Rename the app | Update `<title>` in `index.html`, the logo text in `buildSidebar()`, and the `appName` default in `defaultData()`. Or just use the Settings page at runtime. |
| Change the accent colour | Update `--accent` and `--accent-light` in `:root` in `styles.css`. |
| Add a data type | Add a `defaultFoo()` function, a `foos: []` array to `defaultData()`, CRUD functions, and a render page. |
| Add CDN libraries | Add a `<script>` tag in `index.html` before `app.js`. |
| Persist more state | Add fields to `defaultData()` and read/write them via `state.data` + `saveData()`. |
