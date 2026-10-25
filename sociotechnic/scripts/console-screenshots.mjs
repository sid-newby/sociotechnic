import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
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
  server = await startServer({ port: 0, runner: () => { throw new Error('Screenshot sessions must never dispatch agents'); } });
  console.log('Demo server', server.url);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 });
  console.log('Browser launched');
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('response', response => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); console.error(errors.at(-1)); } });
  const capture = async name => {
    await page.evaluate(async () => { await document.fonts.ready; for (const el of document.querySelectorAll('textarea')) el.scrollTop = 0; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.mouse.move(1590, 990);
    const png = await page.screenshot({ path: join(root, 'assets/console', name + '.png'), animations: 'disabled', fullPage: false });
    assert.equal(png.readUInt32BE(16), 1600, `${name}: image width`);
    assert.equal(png.readUInt32BE(20), 1000, `${name}: image height`);
    console.log('Captured', name);
  };
  await page.goto(`${server.url}#job=${job.id}`);
  await page.getByRole('heading', { name: 'What the evidence says' }).waitFor();
  await page.getByText('Live', { exact: true }).waitFor();
  await capture('overview');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByLabel('Repository path', { exact: true }).fill('/repos/customer-portal');
  await page.getByLabel('Base branch (optional)', { exact: true }).fill('main');
  await page.getByLabel('What should change?', { exact: true }).fill('Add a searchable activity timeline for support teams. Show who changed each customer record and when. Verify filters, keyboard navigation, and the empty state.');
  await capture('start-a-run');
  await page.getByRole('button', { name: 'Close new run', exact: true }).click();
  await page.getByRole('tab', { name: /Analysis/ }).click();
  await page.getByRole('heading', { name: /^Recorded tokens/ }).waitFor();
  await page.getByRole('heading', { name: /^Recorded tokens/ }).evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.locator('#run-detail').evaluate(el => el.scrollTop -= 24);
  await capture('analysis');
  await page.locator('.round-evidence').scrollIntoViewIfNeeded();
  await page.locator('.round-evidence').evaluate(el => { el.open = true; el.scrollIntoView({ block: 'start' }); });
  await page.getByText('Checks passed', { exact: true }).waitFor();
  await page.locator('#run-detail').evaluate(el => el.scrollTop -= 24);
  await capture('round');
  await page.getByRole('button', { name: 'Agent library', exact: true }).click();
  await page.getByRole('heading', { name: 'Agent library', exact: true }).waitFor();
  await page.getByText('Latest release configuration', { exact: true }).waitFor();
  await capture('agent-library');
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByRole('textbox', { name: /^Agent name/ }).fill('release-planner');
  await page.getByLabel('When should this agent be called?', { exact: true }).fill('Plan application releases with rollout, rollback, and operator verification steps.');
  await page.getByText('Template instructions and record requirements', { exact: true }).click();
  await page.getByRole('button', { name: 'Start from template', exact: true }).click();
  await page.getByText('Template instructions and record requirements', { exact: true }).click();
  const instructions = page.getByRole('textbox', { name: /^Instructions/ });
  await instructions.fill('Specialize in release planning: identify migration order, rollback checkpoints, and operator verification. Preserve all planner contracts below.\n\n' + await instructions.inputValue());
  await page.getByLabel('What does this agent do differently?', { exact: true }).fill('Own release sequencing, rollback checkpoints, and post-release verification rather than general feature implementation planning.');
  await page.getByLabel("I've reviewed these agents and this needs a separate identity.", { exact: true }).check();
  await page.getByRole('dialog', { name: 'Add agent', exact: true }).evaluate(el => el.scrollTop = 0);
  await capture('agent-creation');
  await page.getByRole('button', { name: 'Close add agent', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.goto(`${server.url}#job=${job.id}`);
  await page.getByRole('tab', { name: /Activity/ }).click();
  await page.getByRole('heading', { name: /Dispatch history/ }).evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.locator('#run-detail').evaluate(el => el.scrollTop += 30);
  await capture('activity');
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('button', { name: 'Raw view', exact: true }).waitFor();
  await page.getByRole('navigation', { name: 'Records', exact: true }).getByRole('button', { name: 'plan.md', exact: true }).click();
  await page.locator('.markdown-record').waitFor();
  await capture('records');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Captured eight 1600 x 1000 screenshots with no browser or HTTP errors.');
} finally {
  await browser?.close();
  await server?.close();
  await store.close();
  setStore(undefined);
  rmSync(home, { recursive: true, force: true });
}
