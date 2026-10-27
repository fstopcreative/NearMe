/*
 * Checks the token the admin panel uses, from the command line:
 *
 *   GITHUB_TOKEN=github_pat_… GITHUB_REPO=orhan929292/CRADAR-v4 node scripts/check-github-token.mjs
 *
 * It reports, for the repository and branch the panel is pointed at, whether the
 * token can see the repository, read every file the panel edits, write them, and
 * start the refresh workflow — and on a refusal prints the permission GitHub
 * says the call needed.
 */
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const WORKFLOW = process.env.GITHUB_WORKFLOW || 'refresh-area-data.yml';

if (!REPO || !TOKEN) {
  console.error('Set GITHUB_REPO and GITHUB_TOKEN.');
  process.exit(2);
}

const FILES = [
  'src/data/site-content.json',
  'src/data/reviews.json',
  'scripts/data/config/rail-lines.json',
  'scripts/data/config/facebook-groups.json',
];

async function call(path, method = 'GET') {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'corelain-admin-check' },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, message: body.message, need: r.headers.get('x-accepted-github-permissions'), body };
}

const line = (label, r, extra = '') => {
  const mark = r.ok ? '✓' : '✗';
  const why = r.ok ? extra : `${r.status} ${r.message || ''}${r.need ? ` — needs ${r.need}` : ''}`;
  console.log(`${mark} ${label.padEnd(44)} ${why}`);
};

console.log(`Repository ${REPO}, branch ${BRANCH}\n`);

const repo = await call('');
line('repository visible to the token', repo, repo.ok ? `${repo.body.private ? 'private' : 'public'}, default branch ${repo.body.default_branch}` : '');
if (!repo.ok) {
  console.log('\nA 404 here means the token was never granted this repository (fine-grained tokens list repositories one by one), or GITHUB_REPO is misspelt.');
  process.exit(1);
}

line(`branch ${BRANCH} exists`, await call(`/branches/${encodeURIComponent(BRANCH)}`));

for (const f of FILES) {
  line(`read ${f}`, await call(`/contents/${f}?ref=${encodeURIComponent(BRANCH)}`));
}

// A PUT with no body cannot write anything: GitHub checks the permission first and
// answers 422 when the token may write, 403 when it may not.
const write = await call(`/contents/${FILES[0]}`, 'PUT');
line('write permission (Contents: Read and write)', { ...write, ok: write.status === 422 }, 'granted');

const runs = await call(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
line(`refresh workflow ${WORKFLOW}`, runs, `${(runs.body.total_count ?? 0)} run(s) found`);
if (!runs.ok && runs.status === 404) console.log(`  (404 here also means the workflow file .github/workflows/${WORKFLOW} is not in the repository.)`);
