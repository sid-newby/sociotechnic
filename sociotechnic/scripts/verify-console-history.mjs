import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!args.includes('--stable')) throw new Error('Pass --stable only after the target checkout is no longer being written or built.');
const checkout = realpathSync(resolve(option('--checkout') ?? process.env.SOCIOTECHNIC_REVIEW_CHECKOUT ?? fileURLToPath(new URL('../..', import.meta.url))));
const output = resolve(option('--output') ?? process.env.SOCIOTECHNIC_BROWSER_PROOF ?? mkdtempSync(join(tmpdir(), 'sociotechnic-wave4-proof-')));
mkdirSync(output, { recursive: true });
const root = realpathSync(mkdtempSync(join(tmpdir(), 'sociotechnic-wave4-'))), home = join(root, 'home'), repo = join(root, 'repo');
mkdirSync(home); mkdirSync(repo);
process.env.SOCIOTECHNIC_HOME = home;
process.env.SOCIOTECHNIC_DATABASE_URL = 'off';
process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Console history fixture';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.invalid';
const report = { checkout, output, startedAt: new Date().toISOString(), isolation: { store: 'memory', database: 'off', dispatchCalls: 0, refusedMutations: [], interceptedStarts: [], createdJobs: [] }, checks: [], screenshots: [], runtimeErrors: [], httpErrors: [] };
let store, setStore, server, browser;
let phase = 'harness';
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const moduleAt = path => import(pathToFileURL(join(checkout, 'sociotechnic', path)).href);
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
async function check(name, run, category = 'ui') {
  const start = Date.now();
  try { const details = await run(); report.checks.push({ name, category, ok: true, ms: Date.now() - start, ...(details === undefined ? {} : { details }) }); }
  catch (error) { report.checks.push({ name, category, ok: false, ms: Date.now() - start, error: error.stack ?? String(error) }); }
  save();
}

try {
  assert.ok(existsSync(join(checkout, 'sociotechnic/ui/web/dist/index.html')), 'Build the stable target before running browser verification.');
  git('init', '-qb', 'main'); writeFileSync(join(repo, 'README.md'), '# Isolated console history fixture\n'); git('add', '.'); git('commit', '-qm', 'fixture');
  const db = await moduleAt('src/db/store.ts'); setStore = db.setStore; store = db.createMemoryStore(); setStore(store);
  const catalog = await moduleAt('src/agent-versions.ts');
  const { startServer } = await moduleAt('ui/server.ts');
  const { chromium } = await import(process.env.SOCIOTECHNIC_PLAYWRIGHT_MODULE ?? 'playwright');
  await catalog.initializeAgentVersions(store);
  server = await startServer({ port: 0, runner: () => { report.isolation.dispatchCalls += 1; throw new Error('Wave 4 browser proof forbids model dispatch'); } });
  const post = async (path, body) => {
    const response = await fetch(new URL(path, server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const seed = join(checkout, 'sociotechnic/ui/seed/demo-job');
  const original = JSON.parse(readFileSync(join(seed, 'job.json'), 'utf8'));
  const fixtureRecords = [];
  const replace = text => text.replaceAll('{{SOCIOTECHNIC_HOME}}', home).replaceAll('{{REPO}}', repo);
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), path = prefix + name;
      if (statSync(full).isDirectory()) walk(full, path + '/');
      else if (!['job.json', 'README.md'].includes(path)) fixtureRecords.push(db.recordRow(path, Buffer.from(replace(readFileSync(full, 'utf8'))), original.updatedAt));
    }
  }
  walk(seed);
  const jobs = {};
  for (const [key, archived] of [['history', false], ['archived', true], ['restore', false]]) {
    const created = await post('/api/jobs', { repo, feature: `Wave 4 ${key} evidence fixture`, consoleHolds: ['planned', 'built'] });
    const current = await store.storedJob(created.job);
    const job = { ...structuredClone(original), id: current.id, feature: current.feature, repo, worktree: current.worktree, branch: current.branch, base: current.base, archived, creation: current.creation, consoleHolds: current.consoleHolds, agentVersions: current.agentVersions, agentConfigurations: current.agentConfigurations, agentRoster: current.agentRoster, agentLocks: current.agentLocks, updatedAt: original.updatedAt };
    for (const [index, dispatch] of job.dispatches.entries()) {
      if (dispatch.finishedAt || dispatch.outcome) dispatch.usage = { ...(dispatch.usage ?? {}), total_cost_usd: Number(((index + 1) * 0.0125).toFixed(4)) };
      if (index === 0 && (dispatch.finishedAt || dispatch.outcome)) dispatch.usage = { ...dispatch.usage, usage: { input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 2, output_tokens_details: { thinking_tokens: 3 } } };
      const config = current.agentConfigurations[dispatch.agent];
      if (config) { dispatch.configuration = config; dispatch.model = config.model; dispatch.effort = config.effort; }
    }
    const build = job.dispatches.find(dispatch => dispatch.step === 'build'); assert.ok(build);
    const retry = { ...structuredClone(build), id: 'd-901', attempt: 2, startedAt: '2026-10-24T06:00:00.000Z', finishedAt: '2026-10-24T06:01:00.000Z', deadlineAt: '2026-10-24T06:30:00.000Z' };
    job.dispatches.push(retry);
    job.rounds[0].reviews['reviewer-code'].findings = [{ severity: 'high', location: 'src/greet.ts:1', text: 'Wave 4 exact feedback finding' }];
    if (key === 'restore') { job.status = 'planned'; job.statusReason = `plan pinned at ${job.base.commit}`; }
    await store.transaction(async tx => {
      await tx.upsertJob(job);
      for (const record of fixtureRecords) await tx.upsertRecord(job.id, record);
      await tx.upsertRecord(job.id, db.recordRow(`${build.record}.superseded-by-${retry.id}`, Buffer.from('# Superseded Wave 4 build evidence\nOriginal attempt, retained verbatim.\n'), original.updatedAt));
      await tx.upsertRecord(job.id, db.recordRow(build.record, Buffer.from('# Current Wave 4 build evidence\nReplacement attempt.\n'), retry.finishedAt));
      await tx.upsertRecord(job.id, db.recordRow('round-1/review-code.md', Buffer.from('# Wave 4 exact feedback finding\n[high] src/greet.ts:1: Review evidence from this dispatch.\n'), original.updatedAt));
    });
    jobs[key] = job;
  }
  const oldBuild = jobs.history.dispatches.find(dispatch => dispatch.step === 'build');
  const builder = oldBuild.agent, builderLabel = builder === 'sociotechnic-builder-lite' ? 'Builder lite' : 'Builder';
  const superseded = `${oldBuild.record}.superseded-by-d-901`;
  const planner = await catalog.agentBase('sociotechnic-planner');
  const pinnedPlanner = jobs.history.agentConfigurations[planner.name];
  const release = await catalog.readAgentVersion(planner, pinnedPlanner.version);
  const parts = release.version.split('.').map(Number), latestVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  await catalog.publishAgentVersion(planner, { ...release.role, expectedLatest: release.version, version: latestVersion, maxTurns: Math.min(250, release.role.maxTurns + 1), label: 'Isolated browser proof release' });
  await check('isolated fixture APIs expose exact superseded records, feedback and pinned releases', async () => {
    const response = await fetch(new URL(`/api/history?job=${jobs.history.id}`, server.url)); const history = await response.json(); assert.equal(response.status, 200);
    assert.equal(history.rows.find(row => row.id === oldBuild.id).record, superseded);
    assert.ok(history.rows.find(row => row.id === 'd-901').observations.some(entry => entry.category === 'review'));
    const meta = await (await fetch(new URL(`/api/meta?job=${jobs.history.id}`, server.url))).json();
    assert.equal(meta.roles.find(role => role.name === planner.name).version, pinnedPlanner.version);
    assert.notEqual(pinnedPlanner.version, latestVersion);
    return { jobs: Object.fromEntries(Object.entries(jobs).map(([key, job]) => [key, job.id])), superseded, builder, pinnedPlanner: pinnedPlanner.version, latestPlanner: latestVersion };
  }, 'harness');
  if (report.checks.some(entry => !entry.ok)) throw new Error('Fixture API proof failed; browser assertions did not run.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 }); phase = 'ui';
  for (const width of [1440, 390]) for (const scheme of ['dark', 'light']) {
    const label = `${width}-${scheme}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: scheme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
    await context.addInitScript(scheme => { localStorage.setItem('sociotechnic.scheme', scheme); }, scheme);
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    let scenario = 'startup', expectedFailure = false, navigation = 0;
    page.on('pageerror', error => report.runtimeErrors.push({ label, scenario, message: error.message }));
    page.on('console', message => { if (message.type() === 'error' && !expectedFailure) report.runtimeErrors.push({ label, scenario, message: message.text() }); });
    page.on('response', response => { if (response.status() >= 400 && !expectedFailure && !response.url().endsWith('/favicon.ico')) report.httpErrors.push({ label, scenario, status: response.status(), url: response.url() }); });
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (['GET', 'HEAD'].includes(request.method())) {
        if (path === '/api/sandboxes') return route.fulfill({ json: { limit: 2, configurable: false, sandboxes: [] } });
        return route.continue();
      }
      if (request.method() === 'POST' && path === '/api/jobs') {
        const response = await route.fetch(); const data = await response.json();
        report.isolation.createdJobs.push({ label, id: data.job, body: request.postDataJSON() });
        return route.fulfill({ response, json: data });
      }
      if (request.method() === 'POST' && path === `/api/jobs/${jobs.restore.id}/restore`) return route.continue();
      if (request.method() === 'POST' && /\/api\/jobs\/[^/]+\/run$/.test(path)) {
        report.isolation.interceptedStarts.push({ label, path, body: request.postDataJSON() });
        return route.fulfill({ status: 409, json: { code: 'fixture-driver-blocked', error: 'Fixture proof: driver start blocked' } });
      }
      report.isolation.refusedMutations.push({ label, path, method: request.method() });
      return route.fulfill({ status: 409, json: { code: 'fixture-mutation-refused', error: 'Fixture proof refuses this mutation' } });
    });
    const capture = async name => {
      await page.evaluate(async () => { await document.fonts.ready; });
      const path = join(output, `${label}-${name}.png`), png = await page.screenshot({ path, animations: 'disabled', fullPage: false });
      assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), width === 390 ? 844 : 1000); report.screenshots.push(path);
    };
    const overflow = async () => {
      const dimensions = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(dimensions.root <= width + 1 && dimensions.body <= width + 1, JSON.stringify(dimensions));
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), scheme === 'dark'); return dimensions;
    };
    const go = params => page.goto(`${server.url}?proof=${label}-${++navigation}#${new URLSearchParams(params)}`);
    const history = async extra => { await go({ view: 'history', historyJob: jobs.history.id, ...extra }); await page.getByRole('heading', { name: 'History', exact: true }).waitFor(); await page.getByRole('heading', { name: 'Dispatch evidence', exact: true }).waitFor(); };
    const choose = async (name, value) => { await page.getByRole('combobox', { name, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click(); };
    const commands = async name => { await page.getByRole('button', { name: 'Commands', exact: true }).click(); const palette = page.getByRole('dialog', { name: 'Commands', exact: true }); await palette.getByRole('option', { name, exact: true }).click(); };
    const settings = async () => { await commands('Settings'); const sheet = page.getByRole('dialog', { name: 'Settings', exact: true }); await sheet.waitFor(); return sheet; };
    await check(`${label}: History layout, archive filters, totals and focus`, async () => {
      scenario = 'history'; await history(); await capture('history'); await overflow();
      const total = await (await fetch(new URL(`/api/history?job=${jobs.history.id}`, server.url))).json();
      await page.getByText(new RegExp(`Matching cohort.*${total.total} dispatches`)).waitFor();
      const usageChart = page.locator('[aria-label="Recorded tokens by completion day"]');
      await usageChart.locator('svg').waitFor(); assert.ok(await usageChart.locator('.recharts-bar-rectangle').count() > 0, 'Recorded token totals must render actual chart bars');
      assert.doesNotMatch(await page.locator('body').innerText(), /Estimated cost|Reported cost|\$[0-9]/, 'Usage reports must not show dollar translations');
      await page.getByText('Input, output and cache breakdown', { exact: true }).click();
      const breakdown = page.getByRole('region', { name: 'Recorded token breakdown' }).first();
      await breakdown.getByText('Uncached input', { exact: true }).waitFor();
      await breakdown.getByText('Thinking · output subset', { exact: true }).waitFor();
      assert.ok((await breakdown.innerText()).includes('reported'), 'Each category exposes report coverage');
      assert.match(await breakdown.innerText(), /not deduplicated session usage|not deduplicated/);
      await page.getByRole('button').filter({ hasText: /^Cache reads/ }).click();
      await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('historyMetric') === 'cacheRead');
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await page.getByRole('button').filter({ hasText: 'Reported tokens' }).click();
      await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('historyMetric') === 'tokens');
      await page.getByRole('region', { name: 'History dispatch evidence' }).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'History dispatch evidence');
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await choose('Archive', 'Archived runs only');
      await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('historyArchive') === 'only');
      const evidence = page.getByRole('region', { name: 'History dispatch evidence' });
      await evidence.getByText(jobs.archived.feature, { exact: true }).first().waitFor();
      assert.equal(await evidence.getByText(jobs.history.feature, { exact: true }).count(), 0);
      await capture('history-archived'); await overflow();
    });
    await check(`${label}: History dispatch opens exact superseded record and survives reload`, async () => {
      scenario = 'superseded-record'; await history();
      const evidence = page.getByRole('region', { name: 'History dispatch evidence' });
      await evidence.getByRole('button', { name: `${oldBuild.id} · round ${oldBuild.round}`, exact: true }).click();
      const dispatch = page.getByRole('dialog', { name: `Dispatch ${oldBuild.id}`, exact: true }); await dispatch.waitFor();
      const read = dispatch.getByRole('button', { name: 'Read record', exact: true }); await read.focus(); await page.keyboard.press('Enter');
      let record = page.getByRole('dialog', { name: superseded, exact: true }); await record.waitFor();
      await record.getByText('Superseded Wave 4 build evidence', { exact: true }).waitFor();
      assert.equal(await record.getByText('Current Wave 4 build evidence', { exact: true }).count(), 0);
      await capture('superseded-record'); await overflow();
      await page.keyboard.press('Escape'); await record.waitFor({ state: 'hidden' }); assert.equal(await read.evaluate(el => el === document.activeElement), true);
      await read.click(); await page.reload();
      record = page.getByRole('dialog', { name: superseded, exact: true }); await record.waitFor(); await record.getByText('Superseded Wave 4 build evidence', { exact: true }).waitFor();
      assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('record'), superseded);
      await capture('superseded-record-reloaded'); await overflow();
      await page.keyboard.press('Escape'); await record.waitFor({ state: 'hidden' });
      await page.keyboard.press('Escape'); await dispatch.waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('dialog').count(), 0);
      await capture('run-after-drilldown'); await overflow();
    });
    await check(`${label}: History empty and retryable failure`, async () => {
      scenario = 'history-empty'; await history({ historyRole: 'fixture-no-such-role' });
      await page.getByText('No dispatches match this view. Clear a filter to broaden the history.', { exact: true }).waitFor(); await capture('history-empty'); await overflow();
      scenario = 'history-error'; expectedFailure = true;
      const path = '**/api/history?*';
      await page.route(path, route => route.fulfill({ status: 503, json: { error: 'Wave 4 fixture history unavailable' } }));
      try {
        await go({ view: 'history' }); await page.getByRole('alert').filter({ hasText: 'Wave 4 fixture history unavailable' }).waitFor(); await capture('history-error'); await overflow();
      } finally { await page.unroute(path); expectedFailure = false; }
      await page.getByRole('button', { name: 'Retry history', exact: true }).click(); await page.getByRole('heading', { name: 'Dispatch evidence', exact: true }).waitFor(); expectedFailure = false;
    });
    await check(`${label}: global Agents switch to pinned run configuration and metric feedback`, async () => {
      scenario = 'agents'; await go({ view: 'agents', agent: 'sociotechnic-planner' });
      let dossier = page.getByRole('article', { name: 'Planner profile', exact: true }); await dossier.waitFor();
      await dossier.getByRole('heading', { name: 'Latest release configuration', exact: true }).waitFor();
      await dossier.getByRole('heading', { level: 2 }).filter({ hasText: `v${latestVersion}` }).waitFor();
      await choose('In run', `${jobs.history.feature} · ${jobs.history.id}`);
      dossier = page.getByRole('article', { name: 'Planner profile', exact: true }); await dossier.getByText('Pinned to this run.', { exact: true }).waitFor();
      await dossier.getByRole('heading', { name: 'Pinned release configuration', exact: true }).waitFor();
      await dossier.getByRole('heading', { level: 2 }).filter({ hasText: `v${pinnedPlanner.version}` }).waitFor();
      await capture('agents-pinned'); await overflow(); await page.reload();
      await page.getByRole('article', { name: 'Planner profile', exact: true }).getByText('Pinned to this run.', { exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Agent library roster' }).getByRole('button').filter({ hasText: new RegExp(`^${builderLabel} `) }).click();
      dossier = page.getByRole('article', { name: `${builderLabel} profile`, exact: true }); await dossier.waitFor();
      await dossier.getByText('Deployments', { exact: true }).locator('..').getByRole('button').click();
      await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('agentMetric') === 'deployments');
      await dossier.getByRole('region', { name: 'Agent deployment history' }).waitFor();
      await dossier.locator('summary').filter({ hasText: 'Feedback categories' }).click();
      await dossier.getByRole('button', { name: /^Inspect \d+ review findings$/ }).click();
      await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('agentCategory') === 'review');
      const rows = dossier.getByRole('region', { name: 'Agent deployment history' });
      await rows.locator('summary').filter({ hasText: 'feedback observations' }).first().click();
      await rows.getByRole('button', { name: 'Inspect round-1/review-code.md', exact: true }).first().click();
      const feedback = page.getByRole('dialog', { name: 'round-1/review-code.md', exact: true }); await feedback.waitFor(); await feedback.getByText('Wave 4 exact feedback finding', { exact: true }).waitFor();
      await capture('agents-feedback-source'); await overflow();
    });
    await check(`${label}: Settings defaults save, reload and storage failure retain saved state`, async () => {
      scenario = 'settings'; await history(); let sheet = await settings();
      assert.equal(await sheet.getByRole('checkbox', { name: 'Plan ready Required', exact: true }).isDisabled(), true);
      await sheet.getByRole('checkbox', { name: 'Built', exact: true }).check(); await sheet.getByRole('checkbox', { name: 'Reviewed', exact: true }).check();
      await sheet.getByRole('button', { name: 'Save run defaults', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sociotechnic.new-run-holds.v1'))), ['planned', 'built', 'reviewed']);
      await capture('settings-defaults'); await overflow(); await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
      await page.reload(); sheet = await settings();
      assert.equal(await sheet.getByRole('checkbox', { name: 'Built', exact: true }).isChecked(), true); assert.equal(await sheet.getByRole('checkbox', { name: 'Reviewed', exact: true }).isChecked(), true);
      await page.evaluate(() => { window.fixtureSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'sociotechnic.new-run-holds.v1') throw new Error('Fixture browser storage full'); return window.fixtureSetItem.call(this, key, value); }; });
      try {
        await sheet.getByRole('checkbox', { name: 'Checked', exact: true }).check(); await sheet.getByRole('button', { name: 'Save run defaults', exact: true }).click();
        await sheet.getByRole('alert').filter({ hasText: 'Your default holds were not saved' }).waitFor(); assert.equal(await sheet.getByRole('checkbox', { name: 'Checked', exact: true }).isChecked(), true);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sociotechnic.new-run-holds.v1'))), ['planned', 'built', 'reviewed']);
        await capture('settings-save-failed'); await overflow();
      } finally { await page.evaluate(() => { Storage.prototype.setItem = window.fixtureSetItem; delete window.fixtureSetItem; }); }
      await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
    });
    await check(`${label}: New run pins saved defaults and protects initial plan hold`, async () => {
      scenario = 'new-run-defaults'; await history();
      const trigger = page.getByRole('button', { name: 'New run', exact: true });
      if (!await trigger.isVisible()) await page.getByRole('button', { name: /^Toggle sidebar$/i }).click();
      await trigger.click(); const dialog = page.getByRole('dialog', { name: 'Start a run', exact: true }); await dialog.waitFor();
      await dialog.getByRole('textbox', { name: 'Repository path', exact: true }).fill(repo);
      await dialog.getByRole('textbox', { name: 'What should change?', exact: true }).fill(`Wave 4 new run pin ${label}`);
      expectedFailure = true;
      try {
        await dialog.getByRole('button', { name: 'Start planning', exact: true }).click();
        await dialog.getByRole('alert').filter({ hasText: 'Fixture proof: driver start blocked' }).waitFor();
        const created = report.isolation.createdJobs.findLast(entry => entry.label === label); assert.ok(created?.id);
        assert.deepEqual(created.body.consoleHolds, ['planned', 'built', 'reviewed']); assert.deepEqual((await store.storedJob(created.id)).consoleHolds, ['planned', 'built', 'reviewed']);
        const start = report.isolation.interceptedStarts.findLast(entry => entry.label === label); assert.deepEqual(start.body.hold, ['planned', 'built', 'reviewed']);
        assert.equal((await store.storedJob(created.id)).dispatches.length, 0); await capture('new-run-pinned'); await overflow();
      } finally {
        expectedFailure = false;
        if (await dialog.isVisible()) { await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); }
        const sidebar = page.getByRole('dialog', { name: 'Sidebar', exact: true });
        if (await sidebar.isVisible()) await page.keyboard.press('Escape');
      }
    });
    await check(`${label}: One-run hold before planning still requires plan review`, async () => {
      scenario = 'initial-plan-hold';
      const created = report.isolation.createdJobs.findLast(entry => entry.label === label); assert.ok(created?.id);
      await go({ job: created.id });
      await page.getByRole('button', { name: 'Run controls', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Continue and hold after a status', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Continue and hold after a status', exact: true });
      await dialog.getByRole('combobox', { name: 'Hold after', exact: true }).click();
      await page.getByRole('option', { name: 'Checked', exact: true }).click();
      expectedFailure = true;
      try {
        const refused = page.waitForResponse(response => new URL(response.url()).pathname === `/api/jobs/${created.id}/run` && response.status() === 409);
        await dialog.getByRole('button', { name: 'Continue and hold after a status', exact: true }).click(); await refused;
        const start = report.isolation.interceptedStarts.findLast(entry => entry.label === label);
        assert.deepEqual(start.body, { mode: 'run', hold: ['planned', 'checked'] });
        assert.equal((await store.storedJob(created.id)).dispatches.length, 0);
        await dialog.getByRole('alert').waitFor(); await capture('initial-plan-hold');
      } finally { expectedFailure = false; }
    });
    await check(`${label}: Restore worktree preserves a human gate without driver execution`, async () => {
      scenario = 'restore'; if (existsSync(jobs.restore.worktree)) git('worktree', 'remove', jobs.restore.worktree);
      const before = await store.storedJob(jobs.restore.id), records = await store.records(jobs.restore.id);
      await go({ job: jobs.restore.id }); await page.getByRole('button', { name: 'Run controls', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Run controls', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Restore worktree', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      await page.getByText('Worktree restored. The run remains paused.', { exact: true }).waitFor();
      assert.equal(existsSync(join(jobs.restore.worktree, 'README.md')), true);
      const after = await store.storedJob(jobs.restore.id);
      for (const key of ['status', 'statusReason', 'plan', 'human', 'overrides', 'rounds', 'dispatches', 'consoleHolds']) assert.deepEqual(after[key], before[key], key);
      assert.deepEqual(await store.records(jobs.restore.id), records); assert.equal(server.drivers.isRunning(jobs.restore.id), false); assert.equal(await store.driver(jobs.restore.id), null); assert.equal(report.isolation.dispatchCalls, 0);
      await capture('restore-paused'); await overflow();
      expectedFailure = true;
      try {
        const refused = page.waitForResponse(response => new URL(response.url()).pathname === `/api/jobs/${jobs.restore.id}/run` && response.status() === 409);
        await page.getByRole('button', { name: 'Continue build', exact: true }).click(); await refused;
        await page.getByText('Fixture proof: driver start blocked', { exact: false }).waitFor();
        const start = report.isolation.interceptedStarts.findLast(entry => entry.label === label && entry.path === `/api/jobs/${jobs.restore.id}/run`);
        assert.deepEqual(start.body, { mode: 'run', hold: ['built'] }, 'Explicit Continue must apply pinned holds and omit the current planned status');
        assert.equal((await store.storedJob(jobs.restore.id)).status, before.status);
        assert.equal(report.isolation.dispatchCalls, 0); await overflow();
      } finally { expectedFailure = false; }
    });
    await check(`${label}: command palette keyboard Escape restores focus`, async () => {
      scenario = 'keyboard'; await history(); const trigger = page.getByRole('button', { name: 'Commands', exact: true }); await trigger.focus(); await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog', { name: 'Commands', exact: true }); await palette.waitFor(); assert.ok(await palette.getByRole('option').count() >= 5);
      await page.keyboard.press('Escape'); await palette.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(el => el === document.activeElement), true); await overflow();
    });
    expectedFailure = false; await context.close();
  }
  await check('browser runtime errors', () => assert.deepEqual(report.runtimeErrors, []), 'runtime');
  await check('unexpected HTTP failures', () => assert.deepEqual(report.httpErrors, []), 'runtime');
  await check('no live model calls or unplanned mutations', () => { assert.equal(report.isolation.dispatchCalls, 0); assert.deepEqual(report.isolation.refusedMutations, []); assert.equal(report.isolation.createdJobs.length, 4); assert.equal(report.isolation.interceptedStarts.filter(entry => entry.path === `/api/jobs/${jobs.restore.id}/run`).length, 4); assert.equal(report.isolation.interceptedStarts.filter(entry => entry.path !== `/api/jobs/${jobs.restore.id}/run`).length, 8); }, 'harness');
} catch (error) {
  report.checks.push({ name: `${phase} setup / uncaught failure`, category: phase === 'harness' ? 'harness' : 'runtime', ok: false, error: error.stack ?? String(error) });
} finally {
  await browser?.close(); await server?.close(); await store?.close(); setStore?.(undefined); rmSync(root, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString(); report.summary = { passed: report.checks.filter(entry => entry.ok).length, failed: report.checks.filter(entry => !entry.ok).length, failures: report.checks.filter(entry => !entry.ok).map(({ name, category, error }) => ({ name, category, error })) };
  save(); console.log(JSON.stringify({ output, ...report.summary }, null, 2)); process.exitCode = report.summary.failed ? 1 : 0;
}
