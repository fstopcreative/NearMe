/*
 * Corelain Near Me — admin panel (/admin).
 *
 * Shows how fresh every data source is (from the public area JSON files and the
 * GitHub Actions refresh runs) and edits the hand-entered content with forms.
 * There is no database: each save commits a JSON file through /api/admin
 * (api/admin.js); Vercel then redeploys the site, and files that feed the data
 * pipeline re-run the refresh workflow.
 */
import '../../styles/admin.css';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const DAY = 864e5;
const fmtDate = (d) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── API ──
async function api(action, { method = 'GET', body, params } = {}) {
  const qs = new URLSearchParams({ action, ...(params || {}) });
  const r = await fetch(`/api/admin?${qs}`, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Corelain-Admin': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && action !== 'login') { showLogin(); throw new Error(data.error || 'Please sign in.'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const loadFile = (id) => api('file', { params: { id } });
const saveFile = (id, content, sha) => api('file', { method: 'PUT', body: { id, content, sha } });
// The file is missing from the repository: start the form from an empty shape
// instead of failing, and say so above it.
const contentOf = (f, blank) => (f.content == null ? clone(blank) : f.content);
function missingNote(f) {
  const el = document.createElement('p');
  el.className = 'adm-banner';
  el.textContent = `${f.path} is not in the repository, so this form starts empty. Saving creates the file.`;
  return el;
}

// ── Remembered across a dev-server reload (a save into public/ reloads the page) ──
const store = {
  get(k, d = null) { try { return sessionStorage.getItem(`cr-adm:${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(`cr-adm:${k}`) : sessionStorage.setItem(`cr-adm:${k}`, v); } catch {} },
};

// ── Toast ──
let toastTimer;
function toast(msg, tone = 'ok', keep = false) {
  if (keep) store.set('toast', `${tone}|${msg}`);
  const el = $('[data-adm-toast]');
  el.textContent = msg;
  el.className = `adm-toast adm-toast--${tone}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; store.set('toast', null); }, tone === 'error' ? 9000 : 6000);
}
function restoreToast() {
  const v = store.get('toast');
  if (!v) return;
  const i = v.indexOf('|');
  toast(v.slice(i + 1), v.slice(0, i));
}

let ME = null;
function savedMessage(res) {
  if (res.applied) return 'Saved and applied to the area data. Reload the site page to see it.';
  if (res.storage === 'local') return res.pipeline
    ? 'Saved to your working copy. Run the data refresh (python3 scripts/data/run.py) to apply it to the area data.'
    : 'Saved to your working copy. The dev server shows it after a page reload.';
  return res.pipeline
    ? 'Saved and committed. The data refresh runs now and the site redeploys in a few minutes.'
    : 'Saved and committed. The site redeploys in about 1–2 minutes.';
}

// ── Small form helpers ──
function field(label, obj, key, { type = 'text', hint = '', today: withToday = false, rows = 3 } = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'adm-field';
  const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  input.className = 'adm-input';
  if (type === 'textarea') input.rows = rows; else input.type = type;
  input.value = obj[key] ?? '';
  input.addEventListener('input', () => (obj[key] = type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value));
  wrap.innerHTML = `<span>${esc(label)}</span>`;
  if (withToday) {
    const row = document.createElement('div');
    row.className = 'adm-inline';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'adm-btn adm-btn--sm'; b.textContent = 'Today';
    b.addEventListener('click', () => { input.value = today(); obj[key] = input.value; setDirty(true); });
    row.append(input, b);
    wrap.append(row);
  } else wrap.append(input);
  if (hint) wrap.insertAdjacentHTML('beforeend', `<small>${esc(hint)}</small>`);
  return wrap;
}

/**
 * Editable table of rows. fields: [{ key, label, type: text|url|number|textarea|checkbox|select|list|pairs, options, width }]
 * list = comma-separated → array; pairs = "Operator | destination" per line → [{ operator, to }].
 */
function listEditor(rows, fields, { addLabel = 'Add row', blank = {} } = {}) {
  const state = rows.map(clone);
  const el = document.createElement('div');
  el.className = 'adm-list';
  const toInput = (f, v) => (f.type === 'list' ? (v || []).join(', ') : f.type === 'pairs' ? (v || []).map((p) => `${p.operator} | ${p.to}`).join('\n') : v ?? '');
  const fromInput = (f, input) => {
    if (f.type === 'checkbox') return input.checked;
    if (f.type === 'number') return input.value === '' ? null : Number(input.value);
    if (f.type === 'list') return input.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (f.type === 'pairs') return input.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([operator, to = '']) => ({ operator, to }));
    return input.value;
  };
  const control = (f, v, i) => {
    const a = `data-i="${i}" data-k="${f.key}" aria-label="${esc(f.label)}"`;
    if (f.type === 'textarea' || f.type === 'pairs') return `<textarea class="adm-input" rows="${f.rows || 2}" ${a}>${esc(toInput(f, v))}</textarea>`;
    if (f.type === 'checkbox') return `<input type="checkbox" ${v ? 'checked' : ''} ${a}>`;
    if (f.type === 'select') return `<select class="adm-input" ${a}>${f.options.map((o) => `<option ${String(o) === String(v ?? '') ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<input class="adm-input" type="${f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(toInput(f, v))}" ${a}>`;
  };
  const render = () => {
    el.innerHTML = `<div class="adm-table-wrap"><table class="adm-table"><thead><tr>${fields.map((f) => `<th style="${f.width ? `width:${f.width}` : ''}">${esc(f.label)}</th>`).join('')}<th class="adm-table__act"></th></tr></thead>
      <tbody>${state.length ? state.map((r, i) => `<tr>${fields.map((f) => `<td data-label="${esc(f.label)}">${control(f, r[f.key], i)}</td>`).join('')}
        <td class="adm-table__act"><button type="button" class="adm-icon" data-move="-1" data-i="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="adm-icon" data-move="1" data-i="${i}" title="Move down" ${i === state.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="adm-icon adm-icon--del" data-del data-i="${i}" title="Remove">✕</button></td></tr>`).join('')
        : `<tr><td colspan="${fields.length + 1}" class="adm-empty">Nothing here yet — use “${esc(addLabel)}” below.</td></tr>`}</tbody></table></div>
      <button type="button" class="adm-btn adm-btn--sm" data-add>+ ${esc(addLabel)}</button>`;
  };
  el.addEventListener('input', (e) => {
    const t = e.target.closest('[data-k]');
    if (!t) return;
    const f = fields.find((x) => x.key === t.dataset.k);
    state[+t.dataset.i][f.key] = fromInput(f, t);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-add')) state.push(clone(blank));
    else if (b.hasAttribute('data-del')) { if (!confirm('Remove this row?')) return; state.splice(+b.dataset.i, 1); }
    else if (b.dataset.move) { const i = +b.dataset.i, j = i + +b.dataset.move; [state[i], state[j]] = [state[j], state[i]]; }
    else return;
    setDirty(true);
    render();
  });
  // checkboxes/selects fire "change", not always "input"
  el.addEventListener('change', (e) => {
    const t = e.target.closest('[data-k]');
    if (!t) return;
    const f = fields.find((x) => x.key === t.dataset.k);
    state[+t.dataset.i][f.key] = fromInput(f, t);
  });
  render();
  return { el, get: () => clone(state) };
}

/** Plain-English help, folded away until it is wanted. */
function note(rows, { open = false, label = 'How this works' } = {}) {
  const el = document.createElement('details');
  el.className = 'adm-note';
  if (open) el.open = true;
  el.innerHTML = `<summary><svg class="adm-note__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>${esc(label)}</summary>
    <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  return el;
}

function card(title, sub = '') {
  const c = document.createElement('div');
  c.className = 'adm-card';
  c.innerHTML = `<div class="adm-card__head"><h2 class="adm-h2">${esc(title)}</h2>${sub ? `<p class="adm-muted">${sub}</p>` : ''}</div><div class="adm-card__body"></div>`;
  return [c, $('.adm-card__body', c)];
}
let dirty = false;
function setDirty(on) {
  dirty = on;
  document.querySelectorAll('.adm-savebar').forEach((bar) => {
    bar.classList.toggle('is-dirty', on);
    const st = $('.adm-savebar__state', bar);
    if (st) st.textContent = on ? 'Unsaved changes' : 'No changes yet';
    const btn = $('button', bar);
    if (btn && btn.dataset.busy !== '1') btn.disabled = !on;
  });
}

function saveBar(onSave, hint = '') {
  const bar = document.createElement('div');
  bar.className = 'adm-savebar';
  bar.innerHTML = `<span class="adm-savebar__state">No changes yet</span><button type="button" class="adm-btn adm-btn--primary" disabled>Save changes</button>`;
  if (hint) $('.adm-savebar__state', bar).title = hint;
  const btn = $('button', bar);
  btn.addEventListener('click', async () => {
    btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Saving…';
    try { toast(savedMessage(await onSave()), 'ok', true); setDirty(false); } catch (e) { toast(e.message, 'error'); }
    delete btn.dataset.busy; btn.textContent = 'Save changes'; btn.disabled = !dirty;
  });
  return bar;
}
function guard(panel, fn) {
  return fn().catch((e) => { panel.innerHTML = `<div class="adm-card"><p class="adm-error">${esc(e.message)}</p></div>`; });
}

// ══════════════════ DATA FRESHNESS ══════════════════
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Latest date mentioned in a period label ("12 months to 31 Jul 2026", "August 2026", "2025 (ASHE…)", "…2026-10-12"). */
function periodDate(p) {
  if (!p) return null;
  let m = [...p.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].pop();
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = [...p.matchAll(/(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/g)].pop();
  if (m && MONTHS.includes(m[2].toLowerCase())) return new Date(Date.UTC(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]));
  m = [...p.matchAll(/\b([A-Za-z]{3,9}) (\d{4})\b/g)].filter((x) => MONTHS.includes(x[1].slice(0, 3).toLowerCase())).pop();
  if (m) return new Date(Date.UTC(+m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, 0));
  // year only: the latest year mentioned ("2026 annual mean (projection from the 2021 base year)" → 2026)
  const years = [...p.matchAll(/\b(20\d\d)\b/g)].map((x) => +x[1]);
  return years.length ? new Date(Date.UTC(Math.max(...years), 6, 1)) : null;
}

// fresh / stale: age of the data period in days; run: no date in the data, so the last refresh run counts
const SOURCES = [
  { label: 'Average price, annual growth, price trend', key: 'average_price', source: 'HM Land Registry Price Paid', fresh: 80, stale: 110, cadence: 'Monthly, around the 20th working day' },
  { label: 'UK House Price Index (Greater Manchester, UK)', key: 'hpi_uk', source: 'UK HPI', fresh: 95, stale: 125, cadence: 'Monthly' },
  { label: 'Average rent', key: 'average_rent', source: 'ONS Price Index of Private Rents', fresh: 80, stale: 110, cadence: 'Monthly' },
  { label: 'Average pay', key: 'earnings', source: 'ONS ASHE', fresh: 600, stale: 760, cadence: 'Yearly (October–November)' },
  { label: 'Crime rating', key: 'crime_rate', source: 'Home Office', fresh: 200, stale: 290, cadence: 'Quarterly' },
  { label: 'School rating', key: 'schools', source: 'Ofsted', fresh: 45, stale: 75, cadence: 'Monthly' },
  { label: 'Transport score', key: 'transport_score', source: 'DfT', fresh: 550, stale: 800, cadence: 'Yearly' },
  { label: 'Trams & buses', key: 'routes', source: 'TfGM timetable', fresh: 10, stale: 21, cadence: 'Weekly' },
  { label: 'Local & surrounding news', key: 'news', source: 'Publisher RSS feeds', fresh: 8, stale: 15, cadence: 'Weekly refresh' },
  { label: 'Air quality (annual)', key: 'air_quality', source: 'Defra', fresh: 400, stale: 500, cadence: 'Yearly' },
  { label: 'Population & households', key: 'population', source: 'Census 2021', fixed: 'Fixed until Census 2031' },
  { label: 'Rent vs ownership', key: 'tenure', source: 'Census 2021', fixed: 'Fixed until Census 2031' },
  { label: 'Conservation areas', key: 'conservation_areas', source: 'planning.data.gov.uk', run: true },
  { label: 'Planning constraints, brownfield, flood zones, AQMA', key: 'planning_constraints', source: 'planning.data.gov.uk', run: true },
  { label: 'Mining, radon & ground', key: 'coal_mining', source: 'Coal Authority · BGS', run: true },
  { label: 'Nearby places', key: 'places', source: 'OpenStreetMap', run: true },
  { label: 'Nearest stops', key: 'nearest_stops', source: 'NaPTAN', run: true },
];
const PILL = { success: 'ok', warning: 'warn', danger: 'bad', neutral: 'flat' };
const badge = (text, tone = 'info') => `<span class="adm-pill${PILL[tone] ? ` adm-pill--${PILL[tone]}` : ''}">${esc(text)}</span>`;

const PRESETS = [
  ['', 'All sources'], ['land_registry,ukhpi', 'House prices'], ['rents,earnings', 'Rent & pay'], ['crime', 'Crime'], ['schools', 'Schools'],
  ['routes', 'Trams, buses & trains'], ['rss_news', 'News'], ['conservation,planning_data,coal,bgs_open', 'Planning & ground'], ['osm,naptan', 'Places & stops'],
];

async function renderOverview(panel) {
  panel.innerHTML = '<div class="adm-card"><p class="adm-muted">Loading…</p></div>';
  const index = await (await fetch('/data/areas/index.json', { cache: 'no-store' })).json();
  const areas = await Promise.all(index.areas.map((a) => fetch(`/data/areas/${a.id}.json`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)));
  const byId = Object.fromEntries(areas.filter(Boolean).map((d) => [d.id, d]));
  const runs = await api('runs').catch((e) => ({ available: false, reason: e.message }));
  const lastOk = (runs.runs || []).find((r) => r.conclusion === 'success');
  const lastRunDate = lastOk ? new Date(lastOk.updated) : null;
  const newestUpdate = index.areas.map((a) => a.updated).filter(Boolean).sort().pop();
  panel.innerHTML = '';

  // ── how the data works ──
  const [c0, b0] = card('How this site gets its data', 'Three different ways. Most of it needs nothing from you.');
  b0.append(note([
    ['Automatic', 'Downloaded from the official sources by GitHub every Monday and on the 23rd of each month: house prices, rent, pay, population, crime, schools, transport score, trams and buses, news, air quality, planning, mining, nearby places, agents and stops. Nothing for you to do — the table below shows how fresh each one is.'],
    ['By hand', 'Everything in the other tabs up there: train lines, the services strip, mortgage lenders, reviews and the per-area extras. No open source publishes these, so you type them here.'],
    ['Live', 'Fetched by the visitor’s own browser each time a page opens, so it is always current: the air quality gauge and the flood warning banner. These never need refreshing.'],
  ]));
  panel.append(c0);

  // ── refresh workflow ──
  const [c1, b1] = card('Automatic data refresh', 'GitHub Actions downloads every source each Monday and on the 23rd of each month, and commits only what changed. You can also start it here.');
  const runRows = runs.available
    ? (runs.runs.length ? runs.runs.map((r) => `<tr><td>${fmtDate(new Date(r.started))} ${new Date(r.started).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(r.event === 'workflow_dispatch' ? 'Started here' : r.event === 'schedule' ? 'Scheduled' : r.event === 'push' ? 'After a save' : r.event)}</td>
        <td>${r.status !== 'completed' ? badge('Running', 'info') : r.conclusion === 'success' ? badge('Succeeded', 'success') : badge(r.conclusion || 'Failed', 'danger')}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">Log</a></td></tr>`).join('')
      : '<tr><td colspan="4" class="adm-muted">No runs yet.</td></tr>')
    : `<tr><td colspan="4" class="adm-muted">${esc(runs.reason || 'Not available.')} Last change in the area data: ${esc(newestUpdate || '—')}.</td></tr>`;
  b1.innerHTML = `<div class="adm-refresh">
      <label class="adm-field"><span>What to refresh</span><select class="adm-input" data-only>${PRESETS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="adm-check"><input type="checkbox" data-force> Re-download files that have not changed</label>
      <button type="button" class="adm-btn adm-btn--primary" data-run ${runs.available ? '' : 'disabled'}>Refresh now</button>
    </div>
    <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th></th></tr></thead><tbody>${runRows}</tbody></table></div>`;
  $('[data-run]', b1).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('refresh', { method: 'POST', body: { only: $('[data-only]', b1).value, force: $('[data-force]', b1).checked } });
      toast('Refresh started. It takes about 5–15 minutes; the site redeploys when it commits.');
      setTimeout(() => renderOverview(panel), 4000);
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });
  panel.append(c1);

  // ── freshness table ──
  const t = byId.trafford || areas.find(Boolean);
  const [c2, b2] = card('Data freshness', `Figures as shown for ${esc(t ? t.name : '—')} (Greater Manchester uses the same sources). “Fresh” means the latest published figures are in; “Check” means a newer release is probably out.`);
  const now = Date.now();
  const rows = SOURCES.map((s) => {
    const rec = t && t.metrics[s.key];
    const errors = areas.filter((d) => d && d.metrics[s.key] && d.metrics[s.key].status === 'error').map((d) => d.name);
    let status, age = null, period = rec ? rec.period || '—' : '—';
    if (!rec) status = badge('Missing', 'neutral');
    else if (errors.length) status = badge(`Error (${errors.length})`, 'danger');
    else if (s.fixed) status = badge(s.fixed, 'neutral');
    else if (s.run) {
      const d = lastRunDate || (newestUpdate ? new Date(newestUpdate) : null);
      age = d ? Math.floor((now - d) / DAY) : null;
      period = d ? `Checked with the refresh of ${fmtDate(d)}` : 'Checked at each refresh';
      status = age == null ? badge('Unknown', 'neutral') : age <= 10 ? badge('Fresh', 'success') : age <= 21 ? badge('Check', 'warning') : badge('Stale', 'danger');
    } else {
      const d = periodDate(rec.period);
      age = d ? Math.floor((now - d) / DAY) : null;
      status = age == null ? badge('Unknown', 'neutral') : age <= s.fresh ? badge('Fresh', 'success') : age <= s.stale ? badge('Check', 'warning') : badge('Stale', 'danger');
    }
    return `<tr><td><b>${esc(s.label)}</b><small class="adm-muted adm-block">${esc(s.source)}</small></td><td>${esc(period)}</td><td class="adm-num">${age == null ? '—' : `${age} d`}</td><td>${esc(s.cadence || (s.run ? 'Each refresh' : 'Census'))}</td><td>${status}${errors.length ? `<small class="adm-muted adm-block">${esc(errors.slice(0, 4).join(', '))}</small>` : ''}</td></tr>`;
  }).join('');
  b2.innerHTML = `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Section</th><th>Data period</th><th>Age</th><th>Source publishes</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  panel.append(c2);

  // ── hand-entered items ──
  const [c3, b3] = card('Hand-entered items', 'These are not downloaded automatically. Review them on the schedule shown and edit them in their tab.');
  const [site, rail] = await Promise.all([loadFile('site-content').catch(() => null), loadFile('rail-lines').catch(() => null)]);
  const due = (dateStr, days) => {
    const d = dateStr ? new Date(dateStr) : null;
    if (!d || isNaN(d)) return [badge('Never reviewed', 'warning'), '—'];
    const age = Math.floor((now - d) / DAY);
    return [age > days ? badge('Review due', 'danger') : age > days * 0.8 ? badge('Due soon', 'warning') : badge('OK', 'success'), fmtDate(d)];
  };
  const manual = areas.filter(Boolean).flatMap((d) => {
    const r = Object.values(d.metrics).find((m) => m.status === 'manual' && m.reviewed);
    return r ? [[`Area data · ${d.name}`, 'Developments, journey, flood detail, places…', r.reviewed, 182, 'manual', d.id]] : [];
  });
  const items = [
    ['Train lines', 'Which lines call at each station', rail && rail.content && rail.content.reviewed, 182, 'rail-lines'],
    ['Top mortgage lenders', 'Big Six shares (Pauzible)', site && site.content && site.content.lenders && site.content.lenders.checked, 365, 'site-content'],
    ['Services strip', 'Corelain services and phone', site && site.content && site.content.updated, 365, 'site-content'],
    ['Client reviews', 'Shown when the list is not empty', null, 365, 'reviews'],
    ...manual,
  ];
  b3.innerHTML = `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Item</th><th>Last reviewed</th><th>Review every</th><th>Status</th><th></th></tr></thead><tbody>${items.map(([label, meta, date, days, tab, area]) => {
    const [st, when] = tab === 'reviews' ? [badge('As needed', 'neutral'), '—'] : due(date, days);
    return `<tr><td><b>${esc(label)}</b><small class="adm-muted adm-block">${esc(meta)}</small></td><td>${when}</td><td>${days >= 365 ? 'Yearly' : '6 months'}</td><td>${st}</td><td><button type="button" class="adm-btn adm-btn--sm" data-goto="${tab}" ${area ? `data-area="${area}"` : ''}>Edit</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  b3.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) { if (b.dataset.area) { MANUAL_AREA = b.dataset.area; store.set('manual-area', MANUAL_AREA); } openTab(b.dataset.goto); }
  });
  panel.append(c3);
}

// ══════════════════ EDITORS ══════════════════
async function renderSiteContent(panel) {
  const f = await loadFile('site-content');
  const c = contentOf(f, { services: [], lenders: {} });
  panel.innerHTML = '';
  const [s1, b1] = card('Services strip', 'The bar at the top of the page that tells visitors Corelain are surveyors.');
  if (f.content == null) b1.append(missingNote(f));
  b1.append(note([
    ['Where it shows', 'The scrolling bar across the very top of every area page, above the area name.'],
    ['When to change it', 'When a service, link or phone number changes. Nothing here is downloaded automatically.'],
    ['When it appears', 'On the live site 1–2 minutes after you save, once the site has rebuilt itself.'],
  ]));
  const grid = document.createElement('div');
  grid.className = 'adm-grid';
  grid.append(field('Name', c.services, 'brand', { hint: 'Write {area} where the selected area should go — “{area} Surveyors” shows as “Trafford Surveyors”.' }), field('Line under the name', c.services, 'tagline'), field('Link (all services page)', c.services, 'url', { type: 'url' }), field('Phone', c.services, 'phone'));
  const services = listEditor(c.services.items || [], [{ key: 'label', label: 'Service' }, { key: 'url', label: 'Link', type: 'url' }], { addLabel: 'Add service', blank: { label: '', url: 'https://www.corelain.com/' } });
  b1.append(grid, services.el);
  const [s2, b2] = card('Top mortgage lenders', 'The “Big Six” card. Share = % of UK gross mortgage lending.');
  b2.append(note([
    ['Where it shows', 'The “Top Mortgage Lenders” card, next to Average Pay.'],
    ['Share', 'Each lender’s % of all UK mortgage lending. The bar lengths are worked out from these numbers, so they always match.'],
    ['When to change it', 'About once a year, when the source article publishes new figures. Set “Last checked” to today when you do — the Data freshness tab then reminds you a year later.'],
  ]));
  const grid2 = document.createElement('div');
  grid2.className = 'adm-grid';
  c.lenders.source = c.lenders.source || { name: '', url: '' };
  grid2.append(field('Title', c.lenders, 'title'), field('Subtitle', c.lenders, 'subtitle'), field('Source name', c.lenders.source, 'name'), field('Source link', c.lenders.source, 'url', { type: 'url' }),
    field('Last checked', c.lenders, 'checked', { type: 'date', today: true }), field('Note under the list', c.lenders, 'note', { type: 'textarea' }));
  const lenders = listEditor(c.lenders.items || [], [{ key: 'name', label: 'Lender' }, { key: 'brands', label: 'Brands / type' }, { key: 'share', label: 'Share %', type: 'number', width: '90px' },
    { key: 'amount', label: 'Lent', width: '100px' }, { key: 'url', label: 'Link', type: 'url' }], { addLabel: 'Add lender', blank: { name: '', brands: '', share: null, amount: '', url: 'https://' } });
  b2.append(grid2, lenders.el);
  panel.append(s1, s2, saveBar(async () => {
    const content = { ...c, updated: today(), services: { ...c.services, items: services.get() }, lenders: { ...c.lenders, items: lenders.get() } };
    const r = await saveFile('site-content', content, f.sha);
    f.sha = r.sha;
    return r;
  }, 'Changes appear on the site after it redeploys.'));
}

async function renderRail(panel) {
  const f = await loadFile('rail-lines');
  const c = contentOf(f, { lines: {}, stations: {} });
  panel.innerHTML = '';
  const [s0, b0] = card('Train lines', 'TfGM’s open timetable has no National Rail services, so the lines calling at each station are kept here.');
  if (f.content == null) b0.append(missingNote(f));
  b0.append(note([
    ['Where it shows', 'The “Trains” column of the Public Transport card on every area page.'],
    ['What is automatic', 'Where each station is and how far it is from the area — that comes from the national stop register. Only the lines calling there are typed here.'],
    ['How the two tables fit together', 'A line in the first table gets a short ID. In the second table you write that ID next to every station the line calls at.'],
    ['Watch out', 'The station name must match the national register exactly, without “Rail Station”. If it does not match, that station simply never appears on the site.'],
    ['When to check it', 'May and December, when train timetables change. Then set “Last reviewed” to today.'],
  ]));
  b0.append(field('Last reviewed', c, 'reviewed', { type: 'date', today: true }));
  const [s1, b1] = card('Lines', 'The ID is what stations refer to.');
  const lines = listEditor(Object.entries(c.lines || {}).map(([id, l]) => ({ id, ...l })),
    [{ key: 'id', label: 'ID', width: '120px' }, { key: 'name', label: 'Line name' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'via', label: 'Via (comma-separated)', type: 'list' }, { key: 'operator', label: 'Operator', width: '130px' }],
    { addLabel: 'Add line', blank: { id: '', name: '', from: '', to: '', via: [], operator: 'Northern' } });
  b1.append(lines.el);
  const [s2, b2] = card('Stations', 'Station name exactly as in NaPTAN (without “Rail Station”). Hubs are listed on the Greater Manchester view. Operators: one per line as “Operator | destinations”.');
  const stations = listEditor(Object.entries(c.stations || {}).map(([name, s]) => ({ name, lines: s.lines || [], hub: !!s.hub, operators: s.operators || [] })),
    [{ key: 'name', label: 'Station', width: '180px' }, { key: 'lines', label: 'Line IDs (comma-separated)', type: 'list' }, { key: 'hub', label: 'Hub', type: 'checkbox', width: '50px' }, { key: 'operators', label: 'Operators (hubs)', type: 'pairs', rows: 2 }],
    { addLabel: 'Add station', blank: { name: '', lines: [], hub: false, operators: [] } });
  b2.append(stations.el);
  panel.append(s0, s1, s2, saveBar(async () => {
    const L = lines.get(), S = stations.get();
    const ids = new Set(L.map((l) => l.id.trim()).filter(Boolean));
    const unknown = S.flatMap((s) => s.lines.filter((x) => !ids.has(x)).map((x) => `${s.name}: ${x}`));
    if (unknown.length) throw new Error(`Unknown line ID — ${unknown.join(', ')}`);
    const content = {
      ...c,
      lines: Object.fromEntries(L.filter((l) => l.id.trim()).map(({ id, ...l }) => [id.trim(), { ...l, via: l.via || [] }])),
      stations: Object.fromEntries(S.filter((s) => s.name.trim()).map(({ name, lines: ls, hub, operators }) => [name.trim(), { ...(ls.length ? { lines: ls } : {}), ...(hub ? { hub: true } : {}), ...(operators.length ? { operators } : {}) }])),
    };
    const r = await saveFile('rail-lines', content, f.sha);
    f.sha = r.sha;
    return r;
  }, 'Saving re-runs the transport step of the data refresh.'));
}

async function areaList() {
  const index = await (await fetch('/data/areas/index.json', { cache: 'no-store' })).json();
  return index.areas;
}

async function renderReviews(panel) {
  const f = await loadFile('reviews');
  const c = contentOf(f, { reviews: [] });
  panel.innerHTML = '';
  const [s1, b1] = card('Client reviews', '“What our clients say” on the area page.');
  if (f.content == null) b1.append(missingNote(f));
  b1.append(note([
    ['Where it shows', 'Near the bottom of every area page. While the list is empty the whole section stays hidden, so an empty list is fine.'],
    ['Only real reviews', 'Publish a client’s words only once they have agreed. A first name and initial is enough for the name.'],
    ['Stars', 'Optional — leave it blank and no stars are shown.'],
  ]));
  const list = listEditor(c.reviews || [], [
    { key: 'quote', label: 'Review', type: 'textarea', rows: 3 }, { key: 'name', label: 'Name (first name + initial)', width: '170px' },
    { key: 'role', label: 'Role', type: 'select', options: ['Homeowner', 'Adjoining owner', 'Architect', 'Builder'], width: '150px' },
    { key: 'area', label: 'Area', width: '130px' }, { key: 'project', label: 'Project', width: '150px' },
    { key: 'rating', label: 'Stars', type: 'select', options: ['', 5, 4, 3, 2, 1], width: '80px' },
  ], { addLabel: 'Add review', blank: { quote: '', name: '', role: 'Homeowner', area: '', project: '', rating: 5 } });
  b1.append(list.el);
  panel.append(s1, saveBar(async () => {
    const reviews = list.get().filter((r) => (r.quote || '').trim()).map((r) => ({ ...r, rating: r.rating === '' || r.rating == null ? null : Number(r.rating) }));
    if (reviews.some((r) => !(r.name || '').trim())) throw new Error('Every review needs a name.');
    const r = await saveFile('reviews', { ...c, reviews }, f.sha);
    f.sha = r.sha;
    return r;
  }));
}

// ── Cover photos ──
// The six files are cut here, in the browser, from one picture: a Vercel
// function has no image tools and a read-only disk, so resizing server-side is
// not an option, and asking for six correctly-sized files by hand would be a
// chore. Ratios and widths mirror SLOTS in scripts/hero-covers.py, so a cover
// made here and one built by the script are the same shape.
const COVER_SLOTS = [
  { key: '800', w: 800, ratio: 16 / 7 }, { key: '1200', w: 1200, ratio: 16 / 7 }, { key: '1440', w: 1440, ratio: 16 / 7 },
  { key: 'm640', w: 640, ratio: 4 / 3 }, { key: 'm960', w: 960, ratio: 4 / 3 }, { key: 'm1200', w: 1200, ratio: 4 / 3 },
];
const COVER_QUALITY = 0.68;                       // matches QUALITY in hero-covers.py
const COVER_MIN_W = 1440;                         // below this the widest size would be upscaled

const loadImage = (file) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(img.src); ok(img); };
  img.onerror = () => { URL.revokeObjectURL(img.src); fail(new Error('That file is not an image the browser can read.')); };
  img.src = URL.createObjectURL(file);
});

// Centre-crop to `ratio`, then scale to `w` — the same two steps as sips -c / --resampleWidth.
function coverSlot(img, { w, ratio }) {
  const sw = Math.min(img.naturalWidth, Math.round(img.naturalHeight * ratio));
  const sh = Math.round(sw / ratio);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round(w / ratio);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, Math.round((img.naturalWidth - sw) / 2), Math.round((img.naturalHeight - sh) / 2), sw, sh, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', COVER_QUALITY));
}
const toBase64 = (blob) => new Promise((ok) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.readAsDataURL(blob);
});

let COVER_AREA = store.get('cover-area', 'trafford');
async function renderCovers(panel) {
  const areas = await areaList();
  panel.innerHTML = '';
  const [s1, b1] = card('Cover photos', 'The picture behind the title on an area page. Areas without one use the default.');
  b1.append(note([
    ['One picture, six files', 'Pick a single wide photo and the panel cuts the six sizes the page needs — three for desktop (16:7) and three for phones (4:3), centre-cropped. You do not need to resize anything first.'],
    ['Use a wide one', `At least ${COVER_MIN_W}px across, landscape. A narrow or small picture gets stretched, and the phone crop keeps only the middle, so put the subject in the centre.`],
    ['Removing it', 'Delete the cover and that area falls back to the default picture straight away. Nothing else breaks.'],
    ['When it appears', 'On the live site 1–2 minutes after you save, once the site has rebuilt itself.'],
  ]));

  const pick = document.createElement('label');
  pick.className = 'adm-field adm-field--inline';
  pick.innerHTML = `<span>Area</span><select class="adm-input">${areas.map((a) => `<option value="${a.id}" ${a.id === COVER_AREA ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  const host = document.createElement('div');
  b1.append(pick, host);
  panel.append(s1);

  const state = { areas: [], file: null, img: null };

  const load = async () => {
    host.innerHTML = '<p class="adm-muted">Loading…</p>';
    state.areas = (await api('covers')).areas;
    state.file = null;
    state.img = null;
    draw();
  };

  function draw() {
    const has = state.areas.includes(COVER_AREA);
    const name = (areas.find((a) => a.id === COVER_AREA) || {}).name || COVER_AREA;
    host.innerHTML = '';

    const status = document.createElement('p');
    status.className = 'adm-banner';
    status.textContent = has
      ? `${name} has its own cover photo. Choosing a picture below replaces it.`
      : `${name} has no cover photo, so it uses the default. Choosing a picture below gives it one.`;
    host.append(status);

    const preview = document.createElement('div');
    preview.className = 'adm-covers';
    preview.innerHTML = has
      ? COVER_SLOTS.map((sl) => `<figure class="adm-cover"><img src="/images/hero/${esc(COVER_AREA)}-${sl.key}.jpg?v=${Date.now()}" alt=""><figcaption>${sl.key}</figcaption></figure>`).join('')
      : `<figure class="adm-cover"><img src="/images/hero-1280.jpg" alt=""><figcaption>default · desktop</figcaption></figure>
         <figure class="adm-cover"><img src="/images/hero-m640.jpg" alt=""><figcaption>default · phone</figcaption></figure>`;
    host.append(preview);

    const file = document.createElement('label');
    file.className = 'adm-field';
    file.innerHTML = '<span>Choose a picture</span>';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'adm-input';
    file.append(input);
    const chosen = document.createElement('small');
    file.append(chosen);
    host.append(file);

    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      state.file = null;
      state.img = null;
      chosen.textContent = '';
      if (!f) { setDirty(false); return; }
      try {
        const img = await loadImage(f);
        if (img.naturalWidth < COVER_MIN_W) {
          chosen.textContent = `${img.naturalWidth}×${img.naturalHeight} — too small; the widest size needs ${COVER_MIN_W}px across.`;
          input.value = '';
          setDirty(false);
          return;
        }
        state.file = f;
        state.img = img;
        chosen.textContent = `${img.naturalWidth}×${img.naturalHeight} · ${(f.size / 1024 / 1024).toFixed(1)} MB — six sizes will be cut from this.`;
        setDirty(true);
      } catch (e) {
        chosen.textContent = e.message;
        input.value = '';
        setDirty(false);
      }
    });

    host.append(saveBar(async () => {
      if (!state.img) throw new Error('Choose a picture first.');
      const images = {};
      for (const sl of COVER_SLOTS) images[sl.key] = await toBase64(await coverSlot(state.img, sl));
      const r = await api('cover', { method: 'PUT', body: { area: COVER_AREA, images } });
      state.areas = r.areas;
      setTimeout(() => { state.file = null; state.img = null; draw(); }, 0);
      return r;
    }, 'The six sizes are cut in your browser, then saved together in one commit.'));

    if (has) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'adm-btn adm-btn--danger';
      del.textContent = 'Remove this cover photo';
      del.addEventListener('click', async () => {
        if (!confirm(`Remove the cover photo for ${name}? It will go back to the default picture.`)) return;
        del.disabled = true;
        try {
          const r = await api('cover', { method: 'DELETE', body: { area: COVER_AREA } });
          state.areas = r.areas;
          toast(savedMessage(r), 'ok', true);
          setDirty(false);
          draw();
        } catch (e) { toast(e.message, 'error'); del.disabled = false; }
      });
      host.append(del);
    }
  }

  $('select', pick).addEventListener('change', (e) => {
    COVER_AREA = e.target.value;
    store.set('cover-area', COVER_AREA);
    setDirty(false);
    load().catch((err) => toast(err.message, 'error'));
  });
  await load();
}

let MANUAL_AREA = store.get('manual-area', 'trafford');
const MANUAL_KEYS = ['flood_risk', 'aqma_roadside', 'journey', 'developments', 'places'];
async function renderManual(panel) {
  const areas = await areaList();
  panel.innerHTML = '';
  const [s1, b1] = card('Area hand-entered data', `Extra values for one area that no open source provides — major developments, journey time, flood risk by source, curated places or agents. Allowed keys: ${MANUAL_KEYS.map((k) => `<code>${k}</code>`).join(', ')}. The format is described in the README (“Fields updated by hand”).`);
  b1.append(note([
    ['What this is for', 'The few things about one area that no open source publishes — major building schemes, the door-to-city-centre journey, flood risk broken down by source, or a hand-picked list of local landmarks.'],
    ['Not a form', 'This one is raw JSON, because each block has a different shape. The README (“Fields updated by hand”) shows an example of each. Anything that is not valid JSON is refused when you save, so you cannot break the site by mistyping.'],
    ['Most areas need nothing here', 'An empty list is normal — the automatic sources already cover these areas.'],
  ]));
  const pick = document.createElement('label');
  pick.className = 'adm-field adm-field--inline';
  pick.innerHTML = `<span>Area</span><select class="adm-input">${areas.map((a) => `<option value="${a.id}" ${a.id === MANUAL_AREA ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  const host = document.createElement('div');
  b1.append(pick, host);
  panel.append(s1);
  const load = async () => {
    host.innerHTML = '<p class="adm-muted">Loading…</p>';
    const f = await loadFile(`manual/${MANUAL_AREA}`);
    const c = f.content || { _comment: `Hand-entered values for ${MANUAL_AREA}.`, reviewed: today(), metrics: {} };
    host.innerHTML = '';
    const unknown = Object.keys(c.metrics || {}).filter((k) => !MANUAL_KEYS.includes(k));
    if (!f.content) host.insertAdjacentHTML('beforeend', '<p class="adm-banner">This area has no hand-entered data yet. Saving creates the file.</p>');
    host.append(field('Last reviewed', c, 'reviewed', { type: 'date', today: true }));
    const ta = document.createElement('textarea');
    ta.className = 'adm-input adm-code';
    ta.rows = 22;
    ta.spellcheck = false;
    ta.value = JSON.stringify(c.metrics || {}, null, 2);
    const wrap = document.createElement('label');
    wrap.className = 'adm-field';
    wrap.innerHTML = `<span>Values (JSON)</span>`;
    wrap.append(ta);
    if (unknown.length) wrap.insertAdjacentHTML('beforeend', `<small>Ignored by the site: ${esc(unknown.join(', '))}</small>`);
    host.append(wrap, saveBar(async () => {
      let metrics;
      try { metrics = JSON.parse(ta.value || '{}'); } catch (e) { throw new Error(`The JSON is not valid: ${e.message}`); }
      if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new Error('Values must be a JSON object, e.g. { "journey": { … } }.');
      const r = await saveFile(`manual/${MANUAL_AREA}`, { ...c, metrics }, f.sha);
      f.sha = r.sha;
      return r;
    }, 'Saving re-merges the hand-entered values into the area data.'));
  };
  $('select', pick).addEventListener('change', (e) => { MANUAL_AREA = e.target.value; store.set('manual-area', MANUAL_AREA); load().catch((err) => toast(err.message, 'error')); });
  await load();
}

// ══════════════════ SHELL ══════════════════
const ICON = {
  gauge: '<path d="M3 12h4l3 8l4 -16l3 8h4"/>',
  briefcase: '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2"/><path d="M3 13a20 20 0 0 0 18 0"/>',
  train: '<path d="M5 15h14"/><path d="M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3z"/><path d="M5 10h14"/><path d="M8 18l-2 3"/><path d="M16 18l2 3"/>',
  home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M10 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>',
  users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  star: '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 13l-1 2l1 2"/><path d="M13 13l1 2l-1 2"/>',
  image: '<path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5"/><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3"/>',
};
const SECTIONS = [
  ['overview', 'Data freshness', 'gauge', 'How current every figure on the site is, and which hand-entered items are due a check.'],
  ['site-content', 'Services & lenders', 'briefcase', 'The services bar at the top of each area page, and the mortgage lenders card.'],
  ['rail-lines', 'Train lines', 'train', 'Which train lines call at each station, for the Public Transport card.'],
  ['reviews', 'Reviews', 'star', 'What our clients say. The section stays hidden while this is empty.'],
  ['manual', 'Area data by hand', 'file', 'Extra values for a single area that no open source publishes.'],
  ['covers', 'Cover photos', 'image', 'The picture behind the title on an area page; areas without one use the default.'],
];
const RENDER = { overview: renderOverview, 'site-content': renderSiteContent, 'rail-lines': renderRail, reviews: renderReviews, manual: renderManual, covers: renderCovers };

function buildNav() {
  $('[data-adm-nav]').innerHTML = SECTIONS.map(([id, label, icon]) => `
    <button type="button" role="tab" class="adm-nav__item" data-tab="${id}" aria-selected="false" title="${esc(label)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[icon]}</svg>
      <span>${esc(label)}</span>
    </button>`).join('');
  $('[data-adm-nav]').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) openTab(t.dataset.tab);
  });
}

// ── mobile drawer ──
function setNav(open) {
  $('.adm-shell').classList.toggle('is-nav-open', open);
  $('[data-adm-backdrop]').hidden = !open;
  $('[data-adm-burger]').setAttribute('aria-expanded', String(open));
  $('[data-adm-burger]').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('adm-locked', open);
}

function openTab(name) {
  if (dirty && !confirm('You have unsaved changes on this page. Leave without saving?')) return;
  setNav(false);
  const [, label, , sub] = SECTIONS.find(([id]) => id === name) || [];
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  $('[data-adm-title]').textContent = label || '';
  $('[data-adm-sub]').textContent = sub || '';
  const panel = $(`[data-panel="${name}"]`);
  history.replaceState(null, '', `#${name}`);
  setDirty(false);
  guard(panel, () => RENDER[name](panel));
}

function showLogin() {
  $('[data-adm-app]').hidden = true;
  $('[data-adm-login]').hidden = false;
}
function showApp(me) {
  ME = me;
  $('[data-adm-login]').hidden = true;
  $('[data-adm-app]').hidden = false;
  $('[data-adm-user]').textContent = me.user;
  $('[data-adm-initial]').textContent = (me.user || 'a').slice(0, 1);
  $('[data-adm-repo]').textContent = me.repo ? `${me.repo}@${me.branch}` : 'local working copy';
  const banner = $('[data-adm-storage]');
  banner.hidden = me.storage === 'github';
  banner.textContent = me.storage === 'local'
    ? 'Local mode: saves are written to this working copy, not committed to GitHub. On the live site they are committed automatically.'
    : 'Saving is not configured (no GITHUB_TOKEN / GITHUB_REPO).';
  const tab = location.hash.slice(1);
  openTab(RENDER[tab] ? tab : 'overview');
  restoreToast();
}

$('[data-adm-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-adm-login-error]');
  err.hidden = true;
  const fd = new FormData(e.target);
  try {
    await api('login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    showApp(await api('me'));
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  }
});
$('[data-adm-logout]').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); showLogin(); });
// ── theme (localStorage, so the anti-flash script in <head> reads the same value) ──
const themeStore = {
  get() { try { return localStorage.getItem('cr-adm:theme'); } catch { return null; } },
  set(v) { try { localStorage.setItem('cr-adm:theme', v); } catch {} },
};
function applyTheme(t) {
  const resolved = t === 'system' || !t ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.setAttribute('data-ax-theme', resolved);
  $('[data-adm-theme-label]').textContent = resolved === 'dark' ? 'Light mode' : 'Dark mode';
}
$('[data-adm-theme]').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-ax-theme') === 'dark' ? 'light' : 'dark';
  themeStore.set(next);
  applyTheme(next);
});

// any edit inside a panel arms the save bar
$('.adm-main').addEventListener('input', (e) => { if (e.target.closest('.adm-panel')) setDirty(true); });
$('.adm-main').addEventListener('change', (e) => { if (e.target.closest('.adm-panel')) setDirty(true); });
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

$('[data-adm-burger]').addEventListener('click', () => setNav(!$('.adm-shell').classList.contains('is-nav-open')));
$('[data-adm-backdrop]').addEventListener('click', () => setNav(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

buildNav();
applyTheme(themeStore.get() || 'system');
api('me').then(showApp).catch(() => showLogin());
