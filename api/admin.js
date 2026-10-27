/*
 * Corelain Near Me — admin API (one Vercel Function, no database).
 *
 *   POST /api/admin?action=login     {username, password}  → session cookie
 *   POST /api/admin?action=logout
 *   GET  /api/admin?action=me
 *   GET  /api/admin?action=file&id=… → {content, sha}       (only the editable files below)
 *   PUT  /api/admin?action=file      {id, content, sha}    → commit
 *   GET  /api/admin?action=runs                            → latest data-refresh workflow runs
 *   POST /api/admin?action=refresh   {only, force}         → start the data-refresh workflow
 *
 * Storage is the Git repository itself: a save commits the JSON file through the
 * GitHub API, which redeploys the site on Vercel (and, for data-pipeline files,
 * re-runs the refresh workflow). In `npm run dev` without a GitHub token the
 * files are written straight to the working copy instead (vite.config.js sets
 * ADMIN_LOCAL_ROOT).
 *
 * Environment (Vercel → Project Settings → Environment Variables):
 *   ADMIN_USER (default "admin"), ADMIN_PASSWORD, SESSION_SECRET (long random string),
 *   GITHUB_TOKEN (fine-grained: Contents read/write + Actions read/write on the repo),
 *   GITHUB_REPO ("owner/name"), GITHUB_BRANCH (default "main"),
 *   GITHUB_WORKFLOW (default "refresh-area-data.yml").
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const env = (k, d = '') => (process.env[k] || d).trim();
const SESSION_HOURS = 12;
const COOKIE = 'cr_admin';

// ── The only files the panel may read or write ──
// pipeline: true → the file feeds scripts/data/run.py, so the refresh workflow re-runs after a save.
const FILES = {
  'site-content': { path: 'src/data/site-content.json', label: 'Services strip & mortgage lenders' },
  reviews: { path: 'src/data/reviews.json', label: 'Client reviews' },
  'rail-lines': { path: 'scripts/data/config/rail-lines.json', label: 'Train lines', pipeline: true },
};
const fileFor = (id) => {
  if (FILES[id]) return FILES[id];
  const m = /^manual\/([a-z0-9-]{2,40})$/.exec(id || '');
  return m ? { path: `scripts/data/manual/${m[1]}.json`, label: `Hand-entered data: ${m[1]}`, pipeline: true } : null;
};

// ── HTTP helpers (plain Node API: works on Vercel and in the Vite dev middleware) ──
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 1_000_000) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => {
  const i = c.indexOf('=');
  return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
}));

// ── Session: signed, expiring cookie (no server-side store) ──
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => createHmac('sha256', env('SESSION_SECRET')).update(data).digest('base64url');
function makeSession(user) {
  const data = b64(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return `${data}.${sign(data)}`;
}
function readSession(req) {
  const raw = cookies(req)[COOKIE];
  if (!raw || !env('SESSION_SECRET')) return null;
  const [data, sig] = raw.split('.');
  if (!data || !sig || !same(sig, sign(data))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function same(a, b) {
  const h = (x) => createHash('sha256').update(String(x)).digest();
  return timingSafeEqual(h(a), h(b));
}
function cookieHeader(req, value, maxAge) {
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(req.headers.host || '');
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
}

// ── Storage: GitHub contents API, or the local working copy in dev ──
const gh = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${env('GITHUB_REPO')}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env('GITHUB_TOKEN')}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'corelain-admin', ...(init.headers || {}) },
  });
  const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(ghMessage(r, body)), { status: r.status === 409 ? 409 : 502 });
  return body;
};

// GitHub's own wording for a token problem says nothing about what to change, and
// the permission the call needed is only in a response header, so spell both out.
function ghMessage(r, body) {
  const msg = body.message || `GitHub ${r.status}`;
  if (r.status === 401) return `GitHub rejected the token (${msg}). GITHUB_TOKEN is wrong or has expired — issue a new one, update it in the Vercel project and redeploy.`;
  if (r.status === 403 && /not accessible|resource not accessible/i.test(msg)) {
    const need = r.headers.get('x-accepted-github-permissions');
    return `GitHub refused the token (${msg}). The token reaches ${env('GITHUB_REPO')} but is missing the permission this needs${need ? ` — ${need}` : ''}. Give it Contents: Read and write (and Actions: Read and write for the refresh button) for that repository, then redeploy.`;
  }
  return msg;
}
const mode = () => (env('GITHUB_TOKEN') && env('GITHUB_REPO') ? 'github' : env('ADMIN_LOCAL_ROOT') ? 'local' : 'none');

// A file that is not there, a repository the token cannot see, a misspelt
// GITHUB_REPO and a branch that does not exist all answer "Not Found", so check
// the repository and the branch before reporting a file as simply absent.
async function checkRepo() {
  const repo = env('GITHUB_REPO'), branch = env('GITHUB_BRANCH', 'main');
  const fail = (what) => Object.assign(new Error(`${what} Check GITHUB_REPO, GITHUB_BRANCH and the token's access to that repository in the Vercel project, then redeploy.`), { status: 503 });
  try { await gh(''); } catch { throw fail(`The repository "${repo}" is not reachable with this token.`); }
  try { await gh(`/branches/${encodeURIComponent(branch)}`); } catch { throw fail(`The repository "${repo}" has no branch "${branch}".`); }
}

async function getFile(path) {
  if (mode() === 'github') {
    try {
      const f = await gh(`/contents/${path}?ref=${encodeURIComponent(env('GITHUB_BRANCH', 'main'))}`);
      return { text: Buffer.from(f.content, 'base64').toString('utf8'), sha: f.sha };
    } catch (e) {
      if (/not found/i.test(e.message)) {
        await checkRepo();
        return { text: null, sha: null };
      }
      throw e;
    }
  }
  if (mode() === 'local') {
    try {
      const text = await readFile(resolve(env('ADMIN_LOCAL_ROOT'), path), 'utf8');
      return { text, sha: createHash('sha1').update(text).digest('hex') };
    } catch {
      return { text: null, sha: null };
    }
  }
  throw Object.assign(new Error('Storage is not configured: set GITHUB_TOKEN and GITHUB_REPO.'), { status: 503 });
}

async function putFile(path, text, sha, message) {
  if (mode() === 'github') {
    const r = await gh(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: Buffer.from(text).toString('base64'), branch: env('GITHUB_BRANCH', 'main'), ...(sha ? { sha } : {}) }),
    });
    return { sha: r.content && r.content.sha, commit: r.commit && r.commit.html_url };
  }
  const full = resolve(env('ADMIN_LOCAL_ROOT'), path);
  const cur = await getFile(path);
  if (cur.sha && sha && cur.sha !== sha) throw Object.assign(new Error('The file changed since you opened it. Reload and try again.'), { status: 409 });
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
  return { sha: createHash('sha1').update(text).digest('hex'), commit: null };
}

// ── Cover photos ──
// Six JPEGs plus the manifest have to land together: one Contents-API call per
// file would be six commits and six deployments, and a half-written set would
// show a cover for an area whose files are not all there yet. So this goes
// through the Git Data API, which builds one tree and one commit for the lot.
// A null `content` deletes that path.
async function putFiles(files, message) {
  const branch = env('GITHUB_BRANCH', 'main');
  if (mode() === 'github') {
    const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const head = ref.object.sha;
    const base = (await gh(`/git/commits/${head}`)).tree.sha;
    const tree = [];
    for (const f of files) {
      if (f.content == null) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.content, encoding: f.encoding || 'utf-8' }) });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base, tree }) });
    const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [head] }) });
    await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    return { commit: commit.html_url };
  }
  if (mode() === 'local') {
    for (const f of files) {
      const full = resolve(env('ADMIN_LOCAL_ROOT'), f.path);
      if (f.content == null) { await rm(full, { force: true }); continue; }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content);
    }
    return { commit: null };
  }
  throw Object.assign(new Error('Storage is not configured: set GITHUB_TOKEN and GITHUB_REPO.'), { status: 503 });
}

// The ladder scripts/hero-covers.py builds, and the manifest crCover() reads.
const COVER_DIR = 'public/images/hero';
const COVER_MANIFEST = 'src/data/hero-covers.json';
const COVER_SLOTS = ['800', '1200', '1440', 'm640', 'm960', 'm1200'];
const coverPath = (area, slot) => `${COVER_DIR}/${area}-${slot}.jpg`;
const isAreaId = (a) => /^[a-z0-9-]{2,40}$/.test(a || '');

async function readManifest() {
  const { text } = await getFile(COVER_MANIFEST);
  try {
    const d = JSON.parse(text || '[]');
    return Array.isArray(d) ? d.filter(isAreaId) : [];
  } catch { return []; }
}

// Local dev only: re-run the cheap pipeline steps so a save shows on the site straight away.
// "none" just re-merges the hand-entered files and downloads nothing.
// Collectors that download (routes, prices…) are left to `python3 scripts/data/run.py`.
const LOCAL_APPLY = { manual: 'none' };
function applyLocally(only) {
  return new Promise((done) => {
    execFile('python3', ['scripts/data/run.py', '--only', only], { cwd: env('ADMIN_LOCAL_ROOT'), timeout: 180e3 }, (err) => done(!err));
  });
}

// ── Validation: JSON only, sane URLs, expected top-level shape ──
const okUrl = (u) => u == null || u === '' || /^(https:\/\/|tel:|mailto:|\/)/i.test(String(u));
function checkUrls(v, where = '') {
  if (Array.isArray(v)) return v.forEach((x, i) => checkUrls(x, `${where}[${i}]`));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/(^url$|_url$|^website$|^href$)/i.test(k) && !okUrl(x)) throw Object.assign(new Error(`${where}.${k}: links must start with https://`), { status: 400 });
      checkUrls(x, `${where}.${k}`);
    }
  }
}
function validate(id, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw Object.assign(new Error('Content must be a JSON object.'), { status: 400 });
  const need = { 'site-content': ['services', 'lenders'], reviews: ['reviews'], 'rail-lines': ['lines', 'stations'] }[id]
    || (id.startsWith('manual/') ? ['metrics'] : []);
  for (const k of need) if (!(k in content)) throw Object.assign(new Error(`Missing "${k}".`), { status: 400 });
  checkUrls(content);
}

// ── Workflow (GitHub Actions data refresh) ──
const workflow = () => env('GITHUB_WORKFLOW', 'refresh-area-data.yml');
async function runs() {
  if (mode() !== 'github') return { available: false, reason: mode() === 'local' ? 'Local mode: the refresh workflow runs on GitHub only.' : 'GitHub is not configured.' };
  const r = await gh(`/actions/workflows/${workflow()}/runs?per_page=8&branch=${encodeURIComponent(env('GITHUB_BRANCH', 'main'))}`);
  return {
    available: true,
    runs: (r.workflow_runs || []).map((x) => ({ id: x.id, event: x.event, status: x.status, conclusion: x.conclusion, started: x.run_started_at || x.created_at, updated: x.updated_at, url: x.html_url, title: x.display_title })),
  };
}
const COLLECTOR_RE = /^[a-z_]+(,[a-z_]+)*$/;
async function dispatch({ only = '', force = false } = {}) {
  if (mode() !== 'github') throw Object.assign(new Error('The refresh workflow can only be started on the live site (GitHub not configured here).'), { status: 503 });
  if (only && !COLLECTOR_RE.test(only)) throw Object.assign(new Error('Invalid collector list.'), { status: 400 });
  await gh(`/actions/workflows/${workflow()}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: env('GITHUB_BRANCH', 'main'), inputs: { only, force: force ? 'true' : 'false' } }) });
  return { ok: true };
}

// ── Handler ──
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const action = url.searchParams.get('action') || '';
  try {
    if (action === 'login' && req.method === 'POST') {
      if (!env('ADMIN_PASSWORD') || !env('SESSION_SECRET')) return send(res, 503, { error: 'Admin login is not configured: set ADMIN_PASSWORD and SESSION_SECRET.' });
      const { username = '', password = '' } = await readBody(req);
      const ok = same(username, env('ADMIN_USER', 'admin')) & same(password, env('ADMIN_PASSWORD'));
      if (!ok) {
        await new Promise((r) => setTimeout(r, 700));          // slow down guessing
        return send(res, 401, { error: 'Wrong username or password.' });
      }
      return send(res, 200, { user: username, storage: mode() }, { 'Set-Cookie': cookieHeader(req, makeSession(username), SESSION_HOURS * 3600) });
    }
    if (action === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });

    const session = readSession(req);
    if (!session) return send(res, 401, { error: 'Please sign in.' });
    // state-changing requests must come from the panel's own script (CSRF guard on top of SameSite=Strict)
    if (req.method !== 'GET' && req.headers['x-corelain-admin'] !== '1') return send(res, 403, { error: 'Forbidden.' });

    if (action === 'me') {
      return send(res, 200, { user: session.u, storage: mode(), repo: env('GITHUB_REPO') || null, branch: env('GITHUB_BRANCH', 'main'),
        files: Object.entries(FILES).map(([id, f]) => ({ id, ...f })) });
    }
    if (action === 'file' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      const f = fileFor(id);
      if (!f) return send(res, 404, { error: 'Unknown file.' });
      const { text, sha } = await getFile(f.path);
      return send(res, 200, { id, path: f.path, label: f.label, pipeline: !!f.pipeline, sha, content: text == null ? null : JSON.parse(text) });
    }
    if (action === 'file' && req.method === 'PUT') {
      const { id, content, sha } = await readBody(req);
      const f = fileFor(id);
      if (!f) return send(res, 404, { error: 'Unknown file.' });
      validate(id, content);
      const text = JSON.stringify(content, null, 2) + '\n';
      const out = await putFile(f.path, text, sha, `admin: update ${f.path} (${session.u})`);
      // local mode: re-merge hand-entered area values into public/data/areas now (no downloads, a few seconds)
      const localOnly = LOCAL_APPLY[id.startsWith('manual/') ? 'manual' : id];
      const applied = mode() === 'local' && localOnly ? await applyLocally(localOnly) : false;
      return send(res, 200, { ok: true, ...out, pipeline: !!f.pipeline, applied, storage: mode() });
    }
    if (action === 'covers' && req.method === 'GET') {
      return send(res, 200, { areas: await readManifest(), slots: COVER_SLOTS, dir: '/' + COVER_DIR.replace(/^public\//, '') });
    }
    if (action === 'cover' && req.method === 'PUT') {
      const { area, images } = await readBody(req, 4_000_000);
      if (!isAreaId(area)) return send(res, 400, { error: 'Bad area id.' });
      const missing = COVER_SLOTS.filter((k) => typeof (images || {})[k] !== 'string' || !images[k]);
      if (missing.length) return send(res, 400, { error: `Missing sizes: ${missing.join(', ')}.` });
      const list = await readManifest();
      const next = [...new Set([...list, area])].sort();
      const out = await putFiles([
        ...COVER_SLOTS.map((k) => ({ path: coverPath(area, k), content: images[k], encoding: 'base64' })),
        { path: COVER_MANIFEST, content: JSON.stringify(next, null, 2) + '\n' },
      ], `admin: cover photo for ${area} (${session.u})`);
      return send(res, 200, { ok: true, area, areas: next, ...out, storage: mode() });
    }
    if (action === 'cover' && req.method === 'DELETE') {
      const { area } = await readBody(req);
      if (!isAreaId(area)) return send(res, 400, { error: 'Bad area id.' });
      const next = (await readManifest()).filter((a) => a !== area);
      const out = await putFiles([
        ...COVER_SLOTS.map((k) => ({ path: coverPath(area, k), content: null })),
        { path: COVER_MANIFEST, content: JSON.stringify(next, null, 2) + '\n' },
      ], `admin: remove the cover photo for ${area} (${session.u})`);
      return send(res, 200, { ok: true, area, areas: next, ...out, storage: mode() });
    }
    if (action === 'runs') return send(res, 200, await runs());
    if (action === 'refresh' && req.method === 'POST') return send(res, 200, await dispatch(await readBody(req)));
    return send(res, 404, { error: 'Unknown action.' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Server error' });
  }
}
