import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createMemoryStore, recordRow, setStore } from '../src/db/store.ts';
import { initializeAgentVersions } from '../src/agent-versions.ts';
import { startServer } from '../ui/server.ts';

const { chromium } = await import(process.env.SOCIOTECHNIC_PLAYWRIGHT_MODULE ?? 'playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const seed = join(root, 'sociotechnic/ui/seed/demo-job');
const home = mkdtempSync(join(tmpdir(), 'sociotechnic-capture-'));
process.env.SOCIOTECHNIC_HOME = home;
process.env.SOCIOTECHNIC_DATABASE_URL = 'off';
const store = createMemoryStore();
setStore(store);
let server, browser;
let dispatchCalls = 0;
try {
  await initializeAgentVersions(store);
  const replace = text => text.replaceAll('{{SOCIOTECHNIC_HOME}}', '/repos/sociotechnic-demo').replaceAll('{{REPO}}', '/repos/greeting-library');
  const job = JSON.parse(replace(readFileSync(join(seed, 'job.json'), 'utf8')));
  await store.transaction(tx => tx.upsertJob(job));
  async function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), path = prefix + name;
      if (statSync(full).isDirectory()) await walk(full, path + '/');
      else if (path !== 'job.json' && path !== 'README.md') await store.transaction(tx => tx.upsertRecord(job.id, recordRow(path, Buffer.from(replace(readFileSync(full, 'utf8'))), job.updatedAt)));
    }
  }
  await walk(seed);
  server = await startServer({ port: 0, runner: () => { dispatchCalls++; throw new Error('Screenshot sessions must never dispatch agents'); } });
  console.log('Demo server', server.url);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 });
  console.log('Browser launched');
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const captured = [];
  const styleProof = [];
  const popupProof = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); console.error(errors.at(-1)); } });
  await context.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).origin !== new URL(server.url).origin || !['GET', 'HEAD'].includes(request.method())) {
      errors.push(`Screenshot request refused: ${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const capture = async name => {
    await page.evaluate(async () => { await document.fonts.ready; for (const el of document.querySelectorAll('textarea')) el.scrollTop = 0; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'shadcn-neutral', `${name}: theme preset`);
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), true, `${name}: dark scheme`);
    const styles = await page.evaluate(() => {
      const visible = element => element.getClientRects().length > 0;
      const buttons = [...document.querySelectorAll('[data-slot=button]')].filter(visible);
      return { minButtonFontPx: Math.min(...buttons.map(element => parseFloat(getComputedStyle(element).fontSize))), textareaResize: [...document.querySelectorAll('textarea')].filter(visible).map(element => getComputedStyle(element).resize), scrollbarColor: getComputedStyle(document.documentElement).scrollbarColor };
    });
    assert.ok(styles.minButtonFontPx >= 13, `${name}: compact buttons must meet the 13px floor`);
    assert.ok(styles.textareaResize.every(value => value === 'none'), `${name}: textarea resize must be owned`);
    assert.notEqual(styles.scrollbarColor, 'auto', `${name}: global scrollbar theme`);
    styleProof.push({ name, ...styles });
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.mouse.move(1590, 990);
    const png = await page.screenshot({ path: join(root, 'assets/console', name + '.png'), animations: 'disabled', fullPage: false });
    assert.equal(png.readUInt32BE(16), 1600, `${name}: image width`);
    assert.equal(png.readUInt32BE(20), 1000, `${name}: image height`);
    captured.push(name);
    console.log('Captured', name);
  };
  await page.goto(`${server.url}#job=${job.id}`);
  await page.getByRole('region', { name: 'Run summary', exact: true }).waitFor();
  await page.getByLabel('Cumulative reported tokens by dispatch', { exact: true }).locator('svg').waitFor();
  await page.getByText('Live', { exact: true }).waitFor();
  await capture('overview');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const newRun = page.getByRole('dialog', { name: 'Start a run', exact: true });
  await newRun.getByLabel('Repository path', { exact: true }).fill('/repos/customer-portal');
  await newRun.getByLabel('Base branch (optional)', { exact: true }).fill('main');
  await newRun.getByLabel('What should change?', { exact: true }).fill('Add a searchable activity timeline for support teams. Show who changed each customer record and when. Verify filters, keyboard navigation, and the empty state.');
  await newRun.evaluate(el => el.scrollTop = 0);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const trigger = newRun.getByRole('combobox', { name: 'Run type', exact: true });
    const triggerBox = await trigger.boundingBox();
    await trigger.click();
    const popup = page.getByRole('listbox');
    await popup.waitFor();
    const popupBox = await popup.boundingBox();
    assert.ok(triggerBox && popupBox, 'Authored select geometry is available');
    assert.ok(Math.abs(triggerBox.width - popupBox.width) <= 1, `Run type popup must match trigger width at ${width}px`);
    assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= width + 1, 'Popup stays within viewport');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.id === 'workflow', undefined, { timeout: 2000 });
    popupProof.push({ width, triggerWidth: triggerBox.width, popupWidth: popupBox.width, keyboardEscapeFocus: true });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await newRun.evaluate(el => el.scrollTop = 0);
  await capture('start-a-run');
  await newRun.getByRole('button', { name: 'Close new run', exact: true }).click();
  await newRun.waitFor({ state: 'hidden' });

  const activity = page.getByRole('region', { name: 'Run activity', exact: true });
  await activity.getByRole('tab', { name: /^Dispatches/ }).click();
  await activity.getByRole('button', { name: job.dispatches[0].id, exact: true }).waitFor();
  await activity.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await capture('activity');
  await page.getByRole('button', { name: 'Run controls', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Round evidence', exact: true }).click();
  const evidence = page.getByRole('dialog', { name: 'Run evidence', exact: true });
  await evidence.getByRole('heading', { name: 'Reviews', exact: true }).waitFor();
  await evidence.getByText('Gate passed', { exact: true }).waitFor();
  await capture('round');
  await evidence.getByRole('button', { name: 'Close', exact: true }).click();
  await evidence.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('heading', { name: 'History', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Dispatch evidence', exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('analysis');
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('heading', { name: 'Agent library', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Latest release configuration', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Agent deployment history', exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('agent-library');
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Add agent', exact: true });
  await draft.getByRole('textbox', { name: /^Agent name/ }).fill('release-planner');
  await draft.getByLabel('When should this agent be called?', { exact: true }).fill('Plan application releases with rollout, rollback, and operator verification steps.');
  await draft.getByText('Template instructions and record requirements', { exact: true }).click();
  await draft.getByRole('button', { name: 'Start from template', exact: true }).click();
  await draft.getByText('Template instructions and record requirements', { exact: true }).click();
  const instructions = draft.getByRole('textbox', { name: /^Instructions/ });
  await instructions.fill('Specialize in release planning: identify migration order, rollback checkpoints, and operator verification. Preserve all planner contracts below.\n\n' + await instructions.inputValue());
  await draft.getByLabel('What does this agent do differently?', { exact: true }).fill('Own release sequencing, rollback checkpoints, and post-release verification rather than general feature implementation planning.');
  await draft.getByLabel("I've reviewed these agents and this needs a separate identity.", { exact: true }).check();
  await draft.evaluate(el => el.scrollTop = 0);
  await capture('agent-creation');
  await draft.getByRole('button', { name: 'Close add agent', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard this agent draft?', exact: true }).getByRole('button', { name: 'Discard draft', exact: true }).click();
  await draft.waitFor({ state: 'hidden' });
  await page.goto(`${server.url}#job=${job.id}`);
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  await page.getByRole('button', { name: 'plan.md', exact: true }).click();
  const record = page.getByRole('dialog', { name: 'plan.md', exact: true });
  await record.getByRole('radio', { name: 'Formatted', exact: true }).waitFor();
  await record.getByRole('article', { name: 'plan.md', exact: true }).waitFor();
  await capture('records');
  await record.getByRole('button', { name: 'Close', exact: true }).click();
  let sandboxResponse = { limit: 'invalid', configurable: false, sandboxes: [] };
  await page.route('**/api/sandboxes', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sandboxResponse) }));
  await page.getByRole('button', { name: 'Sandboxes', exact: true }).click();
  const sandboxes = page.getByRole('dialog', { name: 'Retained sandboxes', exact: true });
  await sandboxes.getByRole('alert').getByText('Invalid sandbox capacity. Refresh to try again.', { exact: true }).waitFor();
  sandboxResponse = { limit: 2, configurable: false, sandboxes: [] };
  await sandboxes.getByRole('button', { name: 'Refresh sandboxes', exact: true }).click();
  await sandboxes.getByText('No retained sandboxes. Capacity is available.', { exact: true }).waitFor();
  sandboxResponse = { limit: 2, configurable: false, sandboxes: [{ name: 'sociotechnic-fixture-only', initialized: true, job: { id: 'fixture-no-real-sandbox', feature: 'Demonstration retained sandbox', status: 'stopped' } }] };
  await sandboxes.getByRole('button', { name: 'Refresh sandboxes', exact: true }).click();
  await sandboxes.getByRole('button', { name: 'Remove sandbox and worktree', exact: true }).click();
  await sandboxes.getByRole('group', { name: 'Confirm sandbox action', exact: true }).getByRole('heading', { name: 'Remove sandbox and worktree?', exact: true }).waitFor();
  await sandboxes.getByRole('button', { name: 'Cancel', exact: true }).click();
  await sandboxes.getByRole('button', { name: 'Remove sandbox and worktree', exact: true }).waitFor();
  await sandboxes.getByRole('button', { name: 'Close sandboxes', exact: true }).click();
  await sandboxes.waitFor({ state: 'hidden' });
  await page.unroute('**/api/sandboxes');
  assert.deepEqual(captured, ['overview', 'start-a-run', 'activity', 'round', 'analysis', 'agent-library', 'agent-creation', 'records']);
  assert.equal(dispatchCalls, 0, 'Screenshot sessions must not dispatch agents');
  if (errors.length) throw new Error(errors.join('\n'));
  const digest = paths => {
    const hash = createHash('sha256');
    for (const path of [...paths].sort()) { hash.update(path); hash.update(readFileSync(join(root, path))); }
    return hash.digest('hex');
  };
  const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'sociotechnic/src', 'sociotechnic/ui', 'sociotechnic/seeds', 'sociotechnic/pnpm-lock.yaml', '.github/scripts/changelog.cjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const buildFiles = readdirSync(join(root, 'sociotechnic/ui/web/dist/assets')).map(name => `sociotechnic/ui/web/dist/assets/${name}`);
  writeFileSync(join(root, 'assets/console/capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceSha256: digest(sourceFiles), buildSha256: digest(['sociotechnic/ui/web/dist/index.html', ...buildFiles]), scriptSha256: digest(['sociotechnic/scripts/console-screenshots.mjs']), fixture: 'sociotechnic/ui/seed/demo-job', viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, scheme: 'dark', preset: 'shadcn-neutral', locale: 'en-US', timezone: 'UTC', reducedMotion: true, dispatchCalls, images: captured.map(name => ({ file: `${name}.png`, sha256: createHash('sha256').update(readFileSync(join(root, 'assets/console', `${name}.png`))).digest('hex') })), styleProof, popupProof, sandboxProof: { browserInterceptedInventory: true, invalidResponseRecovery: true, empty: true, removalConfirmationCancelled: true, realSandboxOperations: 0 } }, null, 2) + '\n');
  console.log('Captured eight 1600 x 1000 screenshots with no browser or HTTP errors.');
} finally {
  try { await browser?.close(); }
  finally {
    try { await server?.close(); }
    finally {
      try { await store.close(); }
      finally { setStore(undefined); rmSync(home, { recursive: true, force: true }); }
    }
  }
}
