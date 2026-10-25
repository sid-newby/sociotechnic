import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createMemoryStore, setStore } from '../src/db/store.ts';
import { initializeAgentVersions } from '../src/agent-versions.ts';
import { createJobOperation } from '../src/job-store.ts';
import { newJob } from '../src/engine.ts';
import { fakeRunner } from '../ui/runner.ts';
import { startServer } from '../ui/server.ts';

const root = mkdtempSync(join(tmpdir(), 'sociotechnic-planner-browser-'));
const proof = process.env.SOCIOTECHNIC_BROWSER_PROOF ?? mkdtempSync(join(tmpdir(), 'sociotechnic-planner-proof-'));
mkdirSync(proof, { recursive: true });
process.env.SOCIOTECHNIC_HOME = root; process.env.SOCIOTECHNIC_DATABASE_URL = 'off';
const store = createMemoryStore(); setStore(store);
const session = `planner-input-${process.pid}`, execute = promisify(execFile);
const browser = async (...args) => (await execute('agent-browser', ['--session', session, ...args], { timeout: 30_000 })).stdout.trim();
let server, rejectNextAnswer = true, answerAttempts = 0;
try {
  await initializeAgentVersions(store, [], []);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'readme.md'), 'tbd\n'); git('add', '.'); git('commit', '-qm', 'seed');
  const { job: id } = await createJobOperation(() => newJob(repo, 'Review Honcho and write a report', null));
  const fake = fakeRunner(new URL('../tests/fixtures/fake-agent.mjs', import.meta.url).pathname);
  const calls = [];
  server = await startServer({ port: 0, runner: () => ({ name: 'fake', async run(entry, role, ctx) {
    calls.push(entry.agent);
    if (calls.length === 1) {
      mkdirSync(dirname(ctx.recordPath), { recursive: true });
      writeFileSync(ctx.recordPath, JSON.stringify({ status: 'needs-input', questions: ['Who is the report for?', 'Which deployment options should it compare?'] }));
      return { outcome: 'ok', usage: null, note: null };
    }
    return fake.run(entry, role, ctx);
  } }) });
  await server.drivers.run(id, 'run', ['planned']); await server.drivers.settled(id);
  // Exercise a real failed transaction; the UI must keep the answer for retry.
  const transaction = store.transaction.bind(store);
  store.transaction = async (fn) => transaction(async (tx) => {
    const upsert = tx.upsertJob.bind(tx);
    tx.upsertJob = async (job) => {
      if (job.human.some((h) => h.action === 'plan-answer')) {
        answerAttempts++;
        if (rejectNextAnswer) { rejectNextAnswer = false; throw new Error('Fixture answer save failed. Try again.'); }
      }
      return upsert(job);
    };
    return fn(tx);
  });
  await browser('set', 'viewport', '1440', '1000');
  await browser('open', `${server.url}#job=${id}`); await browser('wait', '--text', 'Who is the report for?');
  const bar = 'section[aria-label="Your next decision"]';
  assert.match(await browser('get', 'text', bar), /Answer planner/);
  assert.doesNotMatch(await browser('get', 'text', bar), /Continue build|Merge locally|Accept/);
  await browser('screenshot', join(proof, 'questions-desktop.png'), '--full');
  await browser('find', 'role', 'button', 'click', '--name', 'Answer planner', '--exact');
  await browser('wait', '--fn', 'document.activeElement.id === "decision-note"');
  await browser('click', '[role="dialog"] button[type="submit"]');
  assert.match(await browser('get', 'text', '#decision-error'), /Add your answer/);
  const answer = 'For developers. Compare hosted and self-hosted deployment. Produce a report, no app.';
  await browser('fill', '#decision-note', answer);
  await browser('click', '[role="dialog"] button[type="submit"]');
  await browser('wait', '--text', 'Fixture answer save failed');
  assert.equal(await browser('get', 'value', '#decision-note'), answer);
  assert.equal((await store.storedJob(id)).status, 'planning-input');
  await browser('set', 'viewport', '390', '844');
  await browser('screenshot', join(proof, 'answer-mobile-error.png'), '--full');
  assert.equal(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth'), 'true');
  await browser('press', 'Escape');
  await browser('wait', '--fn', 'document.activeElement.textContent === "Answer planner"');
  await browser('press', 'Enter');
  await browser('wait', '--fn', 'document.activeElement.id === "decision-note"');
  await browser('fill', '#decision-note', answer);
  await browser('click', '[role="dialog"] button[type="submit"]');
  await browser('wait', '--text', 'Continue build'); await server.drivers.settled(id);
  const result = await store.storedJob(id);
  assert.equal(result.status, 'planned'); assert.equal(result.round, 0);
  assert.deepEqual(calls, ['sociotechnic-planner', 'sociotechnic-planner']);
  assert.ok(result.dispatches.at(-1).execution.envelope.prompt.includes(answer));
  assert.ok(answerAttempts >= 2);
  await browser('screenshot', join(proof, 'plan-held-mobile.png'), '--full');
  await browser('reload'); await browser('wait', '--text', 'Continue build');
  console.log(JSON.stringify({ passed: true, proof, calls, checks: ['questions before any builder', 'blank validation and focus', 'save failure and retained draft', 'keyboard Escape and focus return', 'mobile overflow', 'answer delivered to planner', 'plan-review hold', 'reload persistence'] }, null, 2));
} finally {
  await browser('close').catch(() => {}); await server?.close(); await store.close(); setStore(null); rmSync(root, { recursive: true, force: true });
}
