import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const checkout = realpathSync(resolve(option('--checkout') ?? process.env.SOCIOTECHNIC_REVIEW_CHECKOUT ?? fileURLToPath(new URL('../..', import.meta.url))));
const smoke = args.includes('--smoke');
if (!args.includes('--stable')) throw new Error('Pass --stable only after the checkout/copy is no longer being written or built.');
const output = resolve(option('--output') ?? process.env.SOCIOTECHNIC_BROWSER_PROOF ?? mkdtempSync(join(tmpdir(), 'sociotechnic-wave2-proof-')));
mkdirSync(output, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'sociotechnic-wave2-home-'));
process.env.SOCIOTECHNIC_HOME = home;
process.env.SOCIOTECHNIC_DATABASE_URL = 'off';
const report = { checkout, output, smoke, startedAt: new Date().toISOString(), isolation: { store: 'memory', database: 'off', dispatchCalls: 0, rejectedMutations: [], interceptedActions: [] }, checks: [], screenshots: [], runtimeErrors: [], httpErrors: [] };
let store, setStore, server, browser;
let phase = 'harness';
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const moduleAt = path => import(pathToFileURL(join(checkout, 'sociotechnic', path)).href);
async function check(name, run, category = 'ui') {
  const start = Date.now();
  try { const details = await run(); report.checks.push({ name, category, ok: true, ms: Date.now() - start, ...(details === undefined ? {} : { details }) }); }
  catch (error) { report.checks.push({ name, category, ok: false, ms: Date.now() - start, error: error.message }); }
  save();
}

try {
  assert.ok(existsSync(join(checkout, 'sociotechnic/ui/web/dist/index.html')), 'Built web dist is missing. Build the stable target before running verification.');
  const db = await moduleAt('src/db/store.ts');
  setStore = db.setStore;
  store = db.createMemoryStore();
  setStore(store);
  const { initializeAgentVersions } = await moduleAt('src/agent-versions.ts');
  const { startServer } = await moduleAt('ui/server.ts');
  const { chromium } = await import(process.env.SOCIOTECHNIC_PLAYWRIGHT_MODULE ?? 'playwright');
  await initializeAgentVersions(store);
  const seed = join(checkout, 'sociotechnic/ui/seed/demo-job');
  const replace = text => text.replaceAll('{{SOCIOTECHNIC_HOME}}', home).replaceAll('{{REPO}}', '/repos/greeting-library');
  const original = JSON.parse(replace(readFileSync(join(seed, 'job.json'), 'utf8')));
  const fixtureRecords = [];
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), path = prefix + name;
      if (statSync(full).isDirectory()) walk(full, path + '/');
      else if (!['job.json', 'README.md'].includes(path)) fixtureRecords.push(db.recordRow(path, Buffer.from(replace(readFileSync(full, 'utf8'))), original.updatedAt));
    }
  }
  walk(seed);
  const moments = ['planned', 'working', 'needs-human', 'ready'];
  const jobs = Object.fromEntries([...moments, 'stopped'].map(moment => {
    const job = structuredClone(original);
    job.id = `20261025-wave2-${moment}`;
    job.status = moment === 'working' ? 'building' : moment;
    job.updatedAt = new Date().toISOString();
    job.feature = `Wave 2 ${moment}: add farewell beside greet`;
    job.statusReason = moment === 'planned' ? `plan pinned at ${original.base.commit}` : moment === 'needs-human' ? 'retry-bound:build (1 + 0 overrides): fixture check failed; inspect the build record' : original.statusReason;
    if (moment === 'stopped') { job.stoppedFrom = 'building'; job.statusReason = 'stopped by human'; }
    if (moment === 'planned') { job.dispatches = job.dispatches.slice(0, 1); job.round = 0; job.rounds = []; }
    if (moment === 'working') {
      job.dispatches = job.dispatches.slice(0, 2);
      Object.assign(job.dispatches[1], { startedAt: new Date(Date.now() - 65000).toISOString(), deadlineAt: new Date(Date.now() + 600000).toISOString(), finishedAt: null, outcome: null, parsed: null, usage: null });
      job.rounds[0].build = null; job.rounds[0].checks = null; job.rounds[0].gate = null; job.rounds[0].reviews = {};
    }
    if (moment === 'needs-human') {
      job.rounds[0].checks.pass = false;
      job.rounds[0].gate = { ...job.rounds[0].gate, pass: false, blockers: ['Fixture test failed: farewell output'], flags: [] };
    }
    return [moment, job];
  }));
  for (const job of Object.values(jobs)) {
    await store.transaction(async tx => {
      await tx.upsertJob(job);
      for (const record of fixtureRecords) {
        if (job.status === 'needs-human' && record.path === 'round-1/checks.json') {
          const checks = JSON.parse(record.text); checks.pass = false;
          Object.assign(checks.results[0], { pass: false, exitCode: 1, tail: 'Fixture test failed: farewell output' });
          await tx.upsertRecord(job.id, db.recordRow(record.path, Buffer.from(JSON.stringify(checks)), record.mtime));
        } else await tx.upsertRecord(job.id, record);
      }
    });
  }
  server = await startServer({ port: 0, runner: () => { report.isolation.dispatchCalls++; throw new Error('Wave 2 review must never dispatch agents'); } });
  await check('memory fixtures and real HTTP routes', async () => {
    const listingResponse = await fetch(new URL('/api/jobs', server.url));
    const listing = await listingResponse.json();
    assert.equal(listingResponse.status, 200, JSON.stringify(listing));
    assert.equal(listing.jobs.length, Object.keys(jobs).length);
    for (const [moment, job] of Object.entries(jobs)) {
      const response = await fetch(new URL(`/api/jobs/${job.id}`, server.url));
      assert.equal(response.status, 200, moment);
      const detail = await response.json();
      assert.equal(detail.job.status, job.status);
      assert.ok(detail.records.some(r => r.path === 'plan.md'));
    }
    return { moments, url: server.url, seed: 'committed demo-job and status variations; browser GET fixture explicitly supplies active-driver metadata for working; no real driver' };
  }, 'harness');
  if (report.checks.some(c => !c.ok)) throw new Error('Fixture HTTP smoke failed; UI assertions have not run.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 });
  phase = 'ui';
  for (const width of smoke ? [1440] : [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
    await context.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      window.EventSource = class extends NativeEventSource {
        constructor(...args) { super(...args); window.fixtureEventSource = this; }
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(3500);
    let expectedFailure = false;
    let scenario = 'startup';
    page.on('pageerror', error => report.runtimeErrors.push({ width, scenario, message: error.message }));
    page.on('console', message => { if (message.type() === 'error' && !expectedFailure) report.runtimeErrors.push({ width, scenario, message: message.text() }); });
    page.on('response', response => { if (response.status() >= 400 && !expectedFailure && !response.url().endsWith('/favicon.ico')) report.httpErrors.push({ width, scenario, status: response.status(), url: response.url() }); });
    await page.route('**/api/**', async route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        report.isolation.rejectedMutations.push({ method: route.request().method(), url: route.request().url() });
        return route.fulfill({ status: 409, json: { code: 'review-read-only', error: 'Review harness refuses mutations' } });
      }
      if (new URL(route.request().url()).pathname === '/api/sandboxes') return route.fulfill({ json: { limit: 2, configurable: false, sandboxes: [] } });
      return route.continue();
    });
    await page.route(`**/api/jobs/${jobs.working.id}`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      const active = jobs.working.dispatches.at(-1);
      data.driver = { ...data.driver, running: true, ownership: { kind: 'local' }, active: [{ dispatchId: active.id, agent: active.agent, startedAt: active.startedAt, deadlineAt: active.deadlineAt, lastActivity: active.startedAt }], queued: [] };
      await route.fulfill({ response, json: data });
    });
    const capture = async name => {
      await page.evaluate(async () => { await document.fonts.ready; });
      const path = join(output, `${width}-${name}.png`);
      const png = await page.screenshot({ path, animations: 'disabled', fullPage: false });
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), width === 390 ? 844 : 1000);
      report.screenshots.push(path); return path;
    };
    const open = async moment => {
      scenario = moment;
      const detailResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/jobs/${jobs[moment].id}` && response.status() === 200);
      await page.goto(`${server.url}#job=${jobs[moment].id}`);
      await detailResponse;
      await page.getByText(/farewell/i).filter({ visible: true }).first().waitFor();
      await page.locator('[role="status"][title="Connected to this console"]').waitFor();
      assert.equal(await page.getByText(/unknown status|last loaded state|data unavailable/i).filter({ visible: true }).count(), 0, 'Console failed to parse or load the fixture');
    };
    const revealSidebar = async () => {
      if (width === 390 && !await page.getByRole('dialog', { name: 'Sidebar', exact: true }).isVisible()) await page.getByRole('button', { name: /^Toggle sidebar$/i }).click();
    };
    const overflow = async () => {
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && s.position !== 'fixed' && (r.right > innerWidth + 2 || r.left < -2) && s.visibility !== 'hidden'; }).slice(0, 12).map(el => ({ tag: el.tagName, role: el.getAttribute('role'), text: el.textContent?.trim().slice(0, 70), left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) })) }));
      assert.ok(dimensions.scroll <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1, JSON.stringify(dimensions));
      return dimensions;
    };
    for (const moment of smoke ? ['ready'] : moments) {
      await check(`${width} ${moment}: page and PNG`, async () => { await open(moment); await capture(moment); });
      await check(`${width} ${moment}: no page overflow`, overflow);
      if (smoke) continue;
      await check(`${width} ${moment}: dashboard cards and tabs`, async () => {
        for (const text of ['Agent time', 'Tokens', 'Cache reads']) await page.getByText(text, { exact: true }).first().waitFor();
        assert.doesNotMatch(await page.locator('body').innerText(), /Estimated cost|\$[0-9]/, 'No dollar translations in the run dashboard');
        for (const name of ['Dispatches', 'Records', 'Log', 'Decisions']) await page.getByRole('tab', { name: new RegExp(`^${name}`) }).waitFor();
      });
      await check(`${width} ${moment}: token card reflects fixture measurements`, async () => {
        const label = page.getByText('Tokens', { exact: true }).first();
        const card = label.locator('xpath=ancestor::*[@data-slot="card"][1]');
        const actual = (await card.locator('[data-slot="card-title"]').textContent()).trim();
        const recorded = jobs[moment].dispatches.filter(dispatch => (dispatch.finishedAt || dispatch.outcome) && typeof dispatch.usage?.total_tokens === 'number');
        const expected = recorded.length ? recorded.reduce((sum, dispatch) => sum + dispatch.usage.total_tokens, 0) : null;
        assert.equal(actual, expected === null ? 'Not reported' : expected.toLocaleString('en-US'));
        if (moment === 'working') assert.match(await card.textContent(), /reporting|reports at completion|unreported|not reported/i, 'Live dispatch must identify unavailable usage');
        return { expectedRecordedTokens: expected, actualCardValue: actual };
      });
      await check(`${width} ${moment}: chart range controls`, async () => {
        for (const name of ['This dispatch', 'This round', 'Whole run']) {
          const control = page.getByRole('button', { name, exact: true }).or(page.getByRole('tab', { name, exact: true })).or(page.getByRole('radio', { name, exact: true }));
          await control.first().click();
        }
      });
      await check(`${width} ${moment}: command palette, Escape and focus return`, async () => {
        const trigger = page.getByRole('button', { name: /^Commands$/i }).first();
        await trigger.click();
        const dialog = page.getByRole('dialog').last(); await dialog.waitFor();
        assert.ok(await dialog.getByRole('option').count() > 0 || await dialog.getByRole('listbox').count() > 0, 'Command dialog has no semantic command options');
        await capture(`${moment}-commands`);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Focus did not return to Commands');
      });
      await page.keyboard.press('Escape');
      await check(`${width} ${moment}: record sheet, raw view and download`, async () => {
        await page.getByRole('tab', { name: /^Records/ }).click();
        const record = page.getByRole('button', { name: /plan\.md/ }).first().or(page.getByRole('row').filter({ hasText: 'plan.md' }).first());
        await record.first().click();
        const sheet = page.getByRole('dialog').last(); await sheet.waitFor();
        await sheet.getByRole('radio', { name: 'Raw', exact: true }).click();
        assert.ok((await sheet.textContent()).includes('farewell'), 'Raw record text is missing');
        const code = sheet.locator('pre.code-record.raw-record'); await code.waitFor();
        const fontSize = await code.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
        assert.ok(fontSize >= 13, `Raw record code font is ${fontSize}px, expected at least13px`);
        const download = sheet.getByRole('link', { name: /Download/ }).first();
        const href = await download.getAttribute('href'); assert.ok(href?.includes('download=1'), 'Record download must use download=1');
        const response = await context.request.get(new URL(href, server.url).href);
        assert.equal(response.status(), 200); assert.match(response.headers()['content-disposition'] ?? '', /attachment/i);
        assert.match(await response.text(), /farewell/i);
        await capture(`${moment}-record`); await overflow();
        await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
      });
      await page.keyboard.press('Escape');
      await check(`${width} ${moment}: dispatch detail sheet`, async () => {
        await page.getByRole('tab', { name: /^Dispatches/ }).click();
        await page.getByRole('button', { name: jobs[moment].dispatches[0].id, exact: true }).click();
        const sheet = page.getByRole('dialog').last(); await sheet.waitFor();
        await sheet.getByText(/fable|planner/i).first().waitFor(); await capture(`${moment}-dispatch`);
        await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
      });
      await page.keyboard.press('Escape');
      if (moment === 'ready') await check(`${width}: metric to dispatch to record close and focus chain`, async () => {
        const trigger = page.getByRole('button', { name: 'Inspect tokens', exact: true });
        await trigger.click();
        const metric = page.getByRole('dialog', { name: 'Tokens', exact: true }); await metric.waitFor();
        const dispatchTrigger = metric.getByRole('button', { name: jobs.ready.dispatches[0].id, exact: true });
        await dispatchTrigger.click();
        const dispatch = page.getByRole('dialog', { name: `Dispatch ${jobs.ready.dispatches[0].id}`, exact: true }); await dispatch.waitFor();
        const recordTrigger = dispatch.getByRole('button', { name: 'Read record', exact: true }); await recordTrigger.click();
        const record = page.getByRole('dialog', { name: 'plan.json', exact: true }); await record.waitFor();
        await record.getByRole('radio', { name: 'Raw', exact: true }).click();
        await record.getByText('farewell', { exact: false }).first().waitFor();
        await capture('metric-dispatch-record-chain'); await overflow();
        await page.keyboard.press('Escape'); await record.waitFor({ state: 'hidden' });
        assert.equal(await recordTrigger.evaluate(element => element === document.activeElement), true, 'Record close must return to dispatch opener');
        await page.keyboard.press('Escape'); await dispatch.waitFor({ state: 'hidden' });
        assert.equal(await dispatchTrigger.evaluate(element => element === document.activeElement), true, 'Dispatch close must return to metric opener');
        await page.keyboard.press('Escape'); await metric.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Metric close must return to its card');
      });
      await page.keyboard.press('Escape');
      if (moment === 'ready') await check(`${width}: chart usage links open dispatch evidence and return focus`, async () => {
        const id = jobs.ready.dispatches[0].id;
        const trigger = page.getByRole('button', { name: `Inspect ${id} usage`, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: `Dispatch ${id}`, exact: true }); await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Read record', exact: true }).waitFor();
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      });
      await page.keyboard.press('Escape');
      if (moment === 'ready') await check(`${width}: column customization and filtered CSV export are functional`, async () => {
        await page.getByRole('tab', { name: /^Dispatches/ }).click();
        const search = page.getByRole('searchbox', { name: 'Search dispatches', exact: true });
        await search.fill('');
        const table = page.getByRole('tabpanel').getByRole('table');
        const order = async () => table.locator('tbody tr').getByRole('button', { name: /^d-[0-9]+$/ }).allTextContents();
        const expected = [...jobs[moment].dispatches].sort((a, b) => (Date.parse(a.finishedAt) - Date.parse(a.startedAt)) - (Date.parse(b.finishedAt) - Date.parse(b.startedAt))).map(dispatch => dispatch.id);
        const sort = table.getByRole('button', { name: 'Sort by Elapsed', exact: true });
        await sort.click();
        const firstOrder = await order();
        assert.ok(JSON.stringify(firstOrder) === JSON.stringify(expected) || JSON.stringify(firstOrder) === JSON.stringify([...expected].reverse()), 'Elapsed sort must follow recorded durations');
        await sort.click();
        const secondOrder = await order();
        assert.deepEqual(secondOrder, [...firstOrder].reverse(), 'Second elapsed click must reverse row order');
        await search.fill('review');
        const filteredOrder = await order();
        assert.ok(filteredOrder.length >= 2 && filteredOrder.length < jobs[moment].dispatches.length, 'Review filter must select a meaningful subset');
        await table.getByRole('button', { name: 'Sort by Model / effort', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Customize columns', exact: true }).click();
        const modelColumn = page.getByRole('menuitemcheckbox', { name: 'Model / effort', exact: true });
        assert.equal(await modelColumn.getAttribute('aria-checked'), 'true');
        await modelColumn.click();
        await page.keyboard.press('Escape');
        assert.equal(await table.getByRole('button', { name: 'Sort by Model / effort', exact: true }).count(), 0);
        const pendingDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
        const download = await pendingDownload;
        assert.equal(download.suggestedFilename(), `${jobs[moment].id}-dispatches.csv`);
        const csv = readFileSync(await download.path(), 'utf8');
        const rows = csv.trim().split(/\r?\n/);
        assert.equal(rows.length, filteredOrder.length + 1, 'CSV must contain only the filtered dispatches');
        assert.deepEqual(rows.slice(1).map(row => row.split(',')[0].replaceAll('"', '')), filteredOrder, 'CSV must preserve the sorted table order');
        assert.ok(!rows[0].includes('Model / effort'), 'CSV must honor visible columns');
        const csvPath = join(output, `${width}-filtered-dispatches.csv`); writeFileSync(csvPath, csv);
        await page.getByRole('button', { name: 'Customize columns', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: 'Model / effort', exact: true }).click();
        await page.keyboard.press('Escape');
        await table.getByRole('button', { name: 'Sort by Model / effort', exact: true }).waitFor();
        await search.fill('');
        return { csvPath, firstOrder, secondOrder, filteredOrder };
      });
      await check(`${width} ${moment}: Log and Decisions empty states`, async () => {
        await page.getByRole('tab', { name: /^Log/ }).click();
        await page.getByText(/no log|logs will|log entries|waiting for.*log|Driver output will appear here/i).first().waitFor();
        await page.getByRole('tab', { name: /^Decisions/ }).click();
        await page.getByText(/no.*decisions|decisions will|no human|Your decisions and notes will appear here/i).first().waitFor();
      });
      if (moment === 'planned' || moment === 'needs-human') await check(`${width} ${moment}: human decision Read sheet`, async () => {
        await page.getByRole('button', { name: /^Read(?:\s|$)/i }).first().click();
        const sheet = page.getByRole('dialog').last(); await sheet.waitFor(); await capture(`${moment}-read`);
        await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' });
      });
      if (moment === 'working') await check(`${width} working: unreported usage is explicit`, async () => {
        await page.getByText(/reporting at completion|no usage|not reported|unreported/i).first().waitFor();
      });
    }
    if (!smoke) {
      if (width === 1440) await check('control dialogs enforce gates and send exact intercepted request bodies', async () => {
        scenario = 'intercepted-controls'; expectedFailure = true;
        const openAction = async (moment, label) => {
          await open(moment);
          await page.getByRole('button', { name: 'Commands', exact: true }).click();
          await page.getByRole('dialog', { name: 'Commands', exact: true }).getByRole('option').filter({ hasText: new RegExp(`^${label}`) }).click();
          const dialog = page.getByRole('dialog', { name: label, exact: true }); await dialog.waitFor(); return dialog;
        };
        const intercept = async (moment, routeName, run) => {
          const path = `**/api/jobs/${jobs[moment].id}/${routeName}`;
          let body;
          await page.route(path, async route => {
            assert.equal(route.request().method(), 'POST'); body = route.request().postDataJSON();
            report.isolation.interceptedActions.push({ route: routeName, job: jobs[moment].id, body });
            await route.fulfill({ status: 409, json: { code: 'fixture-refusal', error: 'Fixture captured request without changing the run' } });
          });
          try {
            await run(() => body);
            await page.getByRole('alert').filter({ hasText: 'Fixture captured request' }).waitFor();
            await page.keyboard.press('Escape');
            return body;
          } finally { await page.unroute(path); }
        };
        const stopNote = '  Stop after preserving this exact note.  ';
        const stopped = await intercept('planned', 'stop', async () => {
          const dialog = await openAction('planned', 'Stop run');
          await dialog.getByRole('textbox', { name: 'Note (optional)', exact: true }).fill(stopNote);
          await dialog.getByRole('button', { name: 'Stop run', exact: true }).click();
        });
        assert.deepEqual(stopped, { note: stopNote });
        const accepted = await intercept('ready', 'accept', async captured => {
          const dialog = await openAction('ready', 'Accept');
          await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
          await dialog.getByRole('alert').filter({ hasText: 'Confirm that you tested' }).waitFor();
          assert.equal(captured(), undefined, 'Untested acceptance must not issue a request');
          await dialog.getByRole('checkbox', { name: /^I tested/ }).check();
          await dialog.getByRole('textbox', { name: 'Note (optional)', exact: true }).fill('  Tested farewell locally  ');
          await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
        });
        assert.deepEqual(accepted, { note: 'Tested farewell locally' });
        const rework = await intercept('needs-human', 'rework', async captured => {
          const dialog = await openAction('needs-human', 'Request rework');
          await dialog.getByRole('button', { name: 'Request rework', exact: true }).click();
          await dialog.getByRole('alert').filter({ hasText: 'Add a note' }).waitFor();
          assert.equal(captured(), undefined, 'Rework without a note must not issue a request');
          await dialog.getByRole('textbox', { name: 'What should happen next?', exact: true }).fill('  Fix the failing farewell expectation  ');
          await dialog.getByRole('button', { name: 'Request rework', exact: true }).click();
        });
        assert.deepEqual(rework, { note: 'Fix the failing farewell expectation' });
        const reopened = await intercept('stopped', 'reopen', async () => {
          const dialog = await openAction('stopped', 'Reopen run');
          await dialog.getByRole('checkbox', { name: 'Discard uncommitted changes', exact: true }).check();
          await dialog.getByRole('button', { name: 'Reopen run', exact: true }).click();
        });
        assert.deepEqual(reopened, { discard: true });
        expectedFailure = false;
        return { captured: report.isolation.interceptedActions };
      });
      expectedFailure = false;
      await check(`${width}: failed log catch-up stays actionable after live SSE and Retry recovers`, async () => {
        scenario = 'log-error-sse'; expectedFailure = true;
        const logPath = `**/api/jobs/${jobs.working.id}/log*`;
        await page.route(logPath, route => route.fulfill({ status: 503, json: { error: 'Fixture log catch-up unavailable' } }));
        await open('working');
        await page.getByRole('tab', { name: /^Log/ }).click();
        const panel = page.getByRole('tabpanel');
        await panel.getByText('Fixture log catch-up unavailable', { exact: false }).waitFor();
        const event = { jobId: jobs.working.id, seq: 1, at: new Date().toISOString(), level: 'info', dispatchId: jobs.working.dispatches.at(-1).id, line: 'Canonical catch-up regression entry' };
        await page.evaluate(event => {
          assertEventSource();
          function assertEventSource() { if (!window.fixtureEventSource) throw new Error('The console did not open its EventSource'); }
          window.fixtureEventSource.dispatchEvent(new MessageEvent('log', { data: JSON.stringify(event) }));
        }, event);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await panel.getByText('Fixture log catch-up unavailable', { exact: false }).waitFor();
        assert.equal(await panel.getByRole('button', { name: /Retry/ }).count(), 1, 'A new SSE event must not hide catch-up failure or its Retry action');
        await capture('log-error-after-sse');
        await page.unroute(logPath);
        await page.route(logPath, route => route.fulfill({ json: { job: jobs.working.id, entries: [event], first: 1, last: 1, more: false } }));
        await panel.getByRole('button', { name: /Retry/ }).click();
        await panel.getByText('Canonical catch-up regression entry', { exact: false }).waitFor();
        assert.equal((await panel.textContent()).match(/Canonical catch-up regression entry/g)?.length, 1);
        assert.equal(await panel.getByText('Fixture log catch-up unavailable', { exact: false }).count(), 0);
        await capture('log-recovered');
        await page.unroute(logPath); expectedFailure = false;
      });
      expectedFailure = false;
      await check(`${width}: list loading skeleton`, async () => {
        scenario = 'list-loading';
        let release; const held = new Promise(resolve => { release = resolve; });
        await page.route('**/api/jobs', async route => { await held; await route.continue(); });
        try {
          await page.goto(server.url, { waitUntil: 'domcontentloaded' });
          await revealSidebar();
          await page.locator('[data-slot="skeleton"]').first().waitFor(); await capture('list-loading');
        } finally { release(); await page.unroute('**/api/jobs'); }
      });
      await check(`${width}: empty inbox`, async () => {
        scenario = 'empty';
        await page.route('**/api/jobs', route => route.fulfill({ json: { jobs: [], warnings: [], source: 'memory' } }));
        await page.goto(server.url);
        await revealSidebar();
        await page.getByText(/no runs|no jobs|start your first|start a run/i).filter({ visible: true }).first().waitFor();
        assert.equal(await page.getByText(jobs.planned.feature, { exact: true }).count(), 0);
        await capture('empty'); await overflow(); await page.unroute('**/api/jobs');
      });
      await check(`${width}: job-list error and Retry recovery`, async () => {
        scenario = 'list-error'; expectedFailure = true;
        await page.route('**/api/jobs', route => route.fulfill({ status: 503, json: { error: 'Wave 2 fixture: jobs unavailable' } }));
        await page.goto(server.url);
        await revealSidebar();
        await page.getByText('Wave 2 fixture: jobs unavailable', { exact: false }).first().waitFor();
        await capture('list-error');
        await page.unroute('**/api/jobs');
        const resumed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/jobs' && response.status() === 200);
        await page.getByRole('button', { name: 'Retry runs', exact: true }).click();
        const listing = await (await resumed).json();
        assert.equal(listing.jobs.length, Object.keys(jobs).length);
        const first = listing.jobs.find(job => !job.archived);
        await page.getByText(first.feature, { exact: true }).filter({ visible: true }).first().waitFor();
        expectedFailure = false;
      });
      expectedFailure = false;
      await page.unroute('**/api/jobs');
      await check(`${width}: detail error and Retry recovery`, async () => {
        scenario = 'detail-error'; expectedFailure = true;
        const path = `**/api/jobs/${jobs.planned.id}`;
        await page.route(path, route => route.fulfill({ status: 503, json: { error: 'Wave 2 fixture: detail unavailable' } }));
        await page.goto(`${server.url}#job=${jobs.planned.id}`);
        if (await page.getByRole('dialog', { name: 'Sidebar', exact: true }).isVisible()) await page.keyboard.press('Escape');
        await page.getByText('Wave 2 fixture: detail unavailable', { exact: false }).first().waitFor();
        await capture('detail-error'); await page.unroute(path);
        await page.getByRole('button', { name: 'Retry run', exact: true }).click();
        await page.getByRole('tab', { name: /^Dispatches/ }).waitFor(); expectedFailure = false;
      });
      expectedFailure = false;
    }
    await context.close();
  }
  await check('browser runtime errors', () => assert.deepEqual(report.runtimeErrors, []), 'runtime');
  await check('unexpected HTTP failures', () => assert.deepEqual(report.httpErrors, []), 'runtime');
  await check('no model dispatch or unhandled mutation', async () => {
    assert.equal(report.isolation.dispatchCalls, 0); assert.deepEqual(report.isolation.rejectedMutations, []);
    for (const job of Object.values(jobs)) assert.equal((await store.storedJob(job.id)).status, job.status, 'Intercepted controls must leave fixture jobs unchanged');
  }, 'harness');
} catch (error) {
  report.checks.push({ name: `${phase} setup / uncaught failure`, category: phase === 'harness' ? 'harness' : 'runtime', ok: false, error: error.stack });
} finally {
  await browser?.close(); await server?.close(); await store?.close(); setStore?.(undefined);
  rmSync(home, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok).length, failures: report.checks.filter(c => !c.ok).map(c => ({ name: c.name, category: c.category, error: c.error })) };
  save(); console.log(JSON.stringify({ output, ...report.summary }, null, 2));
  process.exitCode = report.summary.failed ? 1 : 0;
}
