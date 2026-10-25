import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createMemoryStore, setStore } from '../src/db/store.ts';
import { initializeAgentVersions } from '../src/agent-versions.ts';
import { createJobOperation, readJob } from '../src/job-store.ts';
import { newDesignJob } from '../src/engine.ts';
import { fakeRunner } from '../ui/runner.ts';
import { startServer } from '../ui/server.ts';
import { fixtureDesignQuery } from '../tests/fixtures/interactive-design.ts';
import { runNative } from '../ui/impeccable.ts';

if (!process.env.SOCIOTECHNIC_TEST_IMPECCABLE_SKILL) throw new Error('Set SOCIOTECHNIC_TEST_IMPECCABLE_SKILL to the installed skill. This script uses no live models.');
const root = mkdtempSync(join(tmpdir(), 'sociotechnic-design-browser-'));
const proof = process.env.SOCIOTECHNIC_BROWSER_PROOF ?? mkdtempSync(join(tmpdir(), 'sociotechnic-design-proof-'));
mkdirSync(proof, { recursive: true });
process.env.SOCIOTECHNIC_HOME = root;
process.env.SOCIOTECHNIC_IMPECCABLE_SKILL = process.env.SOCIOTECHNIC_TEST_IMPECCABLE_SKILL;
process.env.SOCIOTECHNIC_DATABASE_URL = 'off';
const store = createMemoryStore(); setStore(store);
const execute = promisify(execFile);
const browserSession = `interactive-design-${process.pid}`;
const browser = async (...args) => (await execute('agent-browser', ['--session', browserSession, ...args], { timeout: 30_000 })).stdout.trim();
let server, id, native, workspace, nativeKey;
let calls = 0;
let releaseStream;
const pauseStream = signal => new Promise(resolve => {
  const done = () => { signal.removeEventListener('abort', done); resolve(); };
  releaseStream = done;
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});
const longReview = Array.from({ length: 18 }, (_, index) => `### Review ${index + 1}\n\nKeep the source pane readable while the human compares references and asks for revisions. Samples and prototypes open in their own tabs. Verify focus, narrow layouts and the handoff to the planner.\n`).join('\n') + '\n```tsx\nconst prototype = "' + 'long-code-without-wrapping-'.repeat(16) + '";\n```\n\n| Surface | Behavior |\n| --- | --- |\n| Thread | Preserves your reading position |\n| Preview | Opens in another tab |\n\nFinal interaction check.';
const streamEvent = text => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
async function* extraReview(args) {
  const sessionId = args.options.resume ?? args.options.sessionId;
  const uuid = randomUUID();
  const intro = calls === 2 ? '## Revision review\n\nLet us review the reading direction together.\n\n' : '## Thread review\n\nLet us review the reading direction together.\n\n';
  if (calls === 2) {
    const introGate = pauseStream(args.options.abortController.signal);
    // Respect the runner's 250 ms display projection interval between fixture chunks.
    await new Promise(resolve => setTimeout(resolve, 300));
    yield streamEvent(intro);
    await introGate;
    const reviewGate = pauseStream(args.options.abortController.signal);
    await new Promise(resolve => setTimeout(resolve, 300));
    yield streamEvent(longReview);
    await reviewGate;
  }
  const text = intro + longReview;
  await args.options.sessionStore.append({ projectKey: `design-${sessionId}`, sessionId }, [{ type: 'assistant', uuid, message: { role: 'assistant', content: text } }]);
  yield { type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } };
}

const sdkQuery = async function* (args) {
  calls++;
  assert.ok(calls <= 4, 'Unexpected fixture redispatch');
  for await (const event of fixtureDesignQuery(args)) {
    if (event.type === 'result' && !args.options.resume) {
      native = await readJob(id, job => job.designSession.skill);
      workspace = args.options.cwd;
      nativeKey = `${args.options.sessionId}-browser`;
      const payload = { title: 'Native preview integration fixture', question: 'Choose the reading direction', options: [{ id: 'reading', label: 'Reading desk', thesis: 'Keep sources and notes together', palette: ['#172033', '#ffffff'], materials: ['paper'], viewport: 'A notebook beside a reading pane', risk: 'Less dense' }], followup: true };
      writeFileSync(join(workspace, 'question.json'), JSON.stringify(payload));
      const startArgs = ['serve-question', '--start', '--key', nativeKey, '--payload', 'question.json', '--no-open'];
      const output = await runNative(native, workspace, startArgs);
      const base = { session_id: args.options.sessionId, transcript_path: '', cwd: workspace, tool_name: 'Bash', tool_use_id: 'fixture-preview', tool_input: { command: 'impeccable serve-question --start --payload question.json' } };
      for (const group of args.options.hooks.PostToolUse ?? []) for (const hook of group.hooks) await hook({ ...base, hook_event_name: 'PostToolUse', tool_response: { content: [{ type: 'text', text: output }] } }, 'fixture-preview', { signal: args.options.abortController.signal });
      const waitArgs = ['serve-question', '--wait', '--key', nativeKey];
      for (const group of args.options.hooks.PreToolUse ?? []) for (const hook of group.hooks) await hook({ ...base, hook_event_name: 'PreToolUse', tool_input: { command: 'impeccable serve-question --wait' } }, 'fixture-preview', { signal: args.options.abortController.signal });
      const answer = await runNative(native, workspace, waitArgs, args.options.abortController.signal);
      assert.match(answer, /reading/);
      for (const group of args.options.hooks.PostToolUse ?? []) for (const hook of group.hooks) await hook({ ...base, hook_event_name: 'PostToolUse', tool_input: { args: waitArgs }, tool_response: { content: [{ type: 'text', text: answer }] } }, 'fixture-preview', { signal: args.options.abortController.signal });
    }
    if (event.type === 'assistant' && calls === 2) {
      const gate = pauseStream(args.options.abortController.signal);
      yield streamEvent('Revision started.');
      await gate;
    }
    yield event;
    if (event.type === 'assistant' && calls <= 2) yield* extraReview(args);
  }
};
try {
  await initializeAgentVersions(store);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Browser fixture', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'README.md'), '# Fixture research notebook\n'); git('add', '.'); git('commit', '-qm', 'fixture');
  ({ job: id } = await createJobOperation(() => newDesignJob(repo, 'Design a research notebook', null)));
  server = await startServer({ port: 0, designQuery: sdkQuery, runner: () => fakeRunner(new URL('../tests/fixtures/fake-agent.mjs', import.meta.url).pathname) });
  await server.drivers.run(id, 'run', ['planned']);
  const url = `${server.url}#job=${id}`;
  await browser('set', 'viewport', '1440', '1000');
  await browser('open', url);
  await browser('wait', '--text', 'Who will use this workspace?');
  await browser('set', 'viewport', '390', '844');
  assert.equal(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth'), 'true');
  await browser('screenshot', join(proof, 'question-mobile.png'), '--full');
  await browser('set', 'viewport', '1440', '1000');
  await browser('check', '.design-answer-options label:first-child input');
  await browser('find', 'role', 'button', 'click', '--name', 'Reply to Claude');
  await browser('wait', '--text', 'Open previews');
  const preview = await browser('get', 'attr', '.design-conversation a[target^="impeccable-"]', 'href');
  assert.match(preview, /^http:\/\/127\.0\.0\.1:[0-9]+\//);
  assert.equal(await browser('get', 'attr', '.design-conversation a[target^="impeccable-"]', 'target'), `impeccable-${(await readJob(id, j => j.designSession)).id}`);
  await browser('screenshot', join(proof, 'conversation-desktop.png'), '--full');
  await browser('tab', 'new', '--label', 'preview', preview);
  await browser('wait', '--text', 'Reading desk');
  await browser('screenshot', join(proof, 'native-preview.png'), '--full');
  await browser('click', 'button.choose[data-id="reading"]');
  await browser('tab', 't1');
  await server.drivers.settled(id);
  await browser('reload');
  await browser('wait', '--text', 'Your message');
  await browser('upload', 'input[type="file"]', join(proof, 'native-preview.png'));
  await browser('wait', '--text', 'native-preview.png');
  await browser('fill', '#design-message', 'IME composition stays in the composer');
  assert.equal(await browser('eval', '(() => { const input = document.querySelector("#design-message"); const event = new KeyboardEvent("keydown", {key:"Enter", code:"Enter", bubbles:true, cancelable:true, isComposing:true}); input.dispatchEvent(event); return event.defaultPrevented; })()'), 'false');
  assert.equal(calls, 1);
  await browser('press', 'Shift+Enter');
  assert.equal(await browser('eval', 'document.querySelector("#design-message").value.includes("\\n")'), 'true');
  await browser('fill', '#design-message', 'Keep this draft after a network error');
  await browser('eval', 'window.fixtureFetch = window.fetch; window.fetch = (...args) => String(args[0]).includes("/design-session/messages") ? Promise.reject(new Error("Fixture network failure")) : window.fixtureFetch(...args)');
  await browser('press', 'Enter');
  await browser('wait', '--text', 'Cannot reach Sociotechnic');
  assert.equal(await browser('get', 'value', '#design-message'), 'Keep this draft after a network error');
  assert.equal(await browser('eval', 'document.querySelectorAll(".design-image-drafts img").length'), '1');
  assert.equal(calls, 1);
  console.log('Native preview, images, IME and failed-send recovery passed');
  await browser('eval', 'window.fetch = window.fixtureFetch; delete window.fixtureFetch');
  await browser('fill', '#design-message', 'Make it denser');
  await browser('press', 'Enter');
  await browser('wait', '--text', 'Revision started.');
  await browser('wait', '--fn', 'document.activeElement?.id === "design-message"');
  const turnOffset = Number(await browser('eval', '(() => { const view = document.querySelector(".design-thread-viewport"); const turns = view.querySelectorAll("[data-human-turn]"); return turns[turns.length - 1].getBoundingClientRect().top - view.getBoundingClientRect().top; })()'));
  assert.ok(turnOffset >= -1 && turnOffset <= 30, `New human turn must anchor near the top: ${turnOffset}`);
  assert.equal(await browser('eval', 'document.activeElement?.id === "design-message"'), 'true');
  await browser('eval', '(() => { const view = document.querySelector(".design-thread-viewport"); view.scrollTop = 0; view.dispatchEvent(new Event("scroll")); })()');
  await browser('wait', '--text', 'Return to latest');
  releaseStream();
  await browser('wait', '--fn', 'Array.from(document.querySelectorAll(".design-message-assistant")).at(-1)?.textContent.includes("Revision review")');
  releaseStream();
  await browser('wait', '--fn', 'document.querySelectorAll(".design-message-assistant").length >= 4 && Array.from(document.querySelectorAll(".design-message-assistant")).at(-1)?.textContent.includes("Final interaction check")');
  assert.equal(await browser('eval', 'document.querySelector(".design-thread-viewport").scrollTop'), '0', 'Streaming must not pull the reader away from history');
  await browser('find', 'role', 'button', 'click', '--name', 'Return to latest');
  assert.equal(await browser('eval', '(() => { const view = document.querySelector(".design-thread-viewport"); return view.scrollHeight - view.scrollTop - view.clientHeight < 3; })()'), 'true');
  releaseStream();
  await server.drivers.settled(id);
  console.log('Anchored turns, streaming and history scrolling passed');
  assert.equal(await browser('eval', 'document.querySelectorAll(".design-message-user img").length'), '1');
  assert.equal(calls, 2);
  await browser('set', 'viewport', '390', '844');
  if (await browser('eval', 'document.documentElement.scrollWidth <= innerWidth') !== 'true') {
    await browser('screenshot', join(proof, 'overflow.png'), '--full');
    writeFileSync(join(proof, 'overflow.json'), await browser('eval', 'JSON.stringify([...document.querySelectorAll("body *")].map(e => ({tag:e.tagName,class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,max:getComputedStyle(e).maxWidth})).filter(e=>e.right>innerWidth+1).slice(-25))'));
  }
  assert.equal(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth'), 'true');
  await browser('screenshot', join(proof, 'conversation-mobile.png'), '--full');
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await browser('set', 'viewport', String(width), String(height));
    for (const scheme of ['dark', 'light']) {
      await browser('eval', `localStorage.setItem('sociotechnic.scheme', '${scheme}')`);
      await browser('reload');
      await browser('wait', '--text', 'Your message');
      assert.equal(await browser('eval', `document.documentElement.classList.contains('dark') === ${scheme === 'dark'}`), 'true');
      await browser('eval', 'document.querySelector("#design-message").scrollIntoView({block:"nearest"})');
      assert.equal(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth'), 'true');
      assert.equal(await browser('eval', '(() => { const input = document.querySelector("#design-message").getBoundingClientRect(); return input.top >= 0 && input.bottom <= innerHeight; })()'), 'true');
      assert.equal(await browser('eval', 'getComputedStyle(document.querySelector(".design-message .record-content")).fontSize === "16px"'), 'true');
      assert.equal(await browser('eval', 'getComputedStyle(document.querySelector("#design-message")).fontSize === "16px"'), 'true');
      assert.equal(await browser('eval', 'getComputedStyle(document.querySelector(".design-chat-footer [data-slot=input-group]")).opacity === "1"'), 'true', 'A disabled Send button must not dim the enabled composer');
      await browser('screenshot', join(proof, `thread-${width}-${scheme}.png`));
    }
  }
  await browser('eval', 'localStorage.setItem("sociotechnic.scheme", "dark")');
  await browser('reload');
  await browser('wait', '--text', 'Your message');
  await browser('set', 'media', 'dark', 'reduced-motion');
  assert.equal(await browser('eval', 'getComputedStyle(document.querySelector(".design-thread-viewport")).scrollBehavior === "auto"'), 'true');
  await browser('set', 'viewport', '1440', '1000');
  await browser('press', 'Meta+b');
  assert.equal(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth'), 'true');
  await browser('press', 'Meta+b');
  const audit = JSON.parse(await browser('a11y', '--selector', '.design-conversation', '--json'));
  writeFileSync(join(proof, 'a11y.json'), JSON.stringify(audit, null, 2));
  assert.equal(audit.data.counts.violations, 0, 'Chat must have no automated accessibility violations');
  await browser('reload');
  await browser('wait', '--text', 'Final interaction check');
  await browser('find', 'role', 'button', 'click', '--name', 'Return work');
  await server.drivers.settled(id);
  await browser('wait', '--text', 'Work returned to the caller');
  for (let n = 0; n < 300 && await readJob(id, j => j.status) !== 'planned'; n++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await readJob(id, j => j.status), 'planned');
  assert.equal(await readJob(id, j => j.round), 0);
  assert.equal(calls, 2);
  await browser('fill', '#design-message', 'hold response');
  await browser('press', 'Enter');
  await browser('wait', '--text', 'Interrupt response');
  await browser('find', 'role', 'button', 'click', '--name', 'Interrupt response');
  await browser('wait', '--text', 'Response interrupted');
  await browser('find', 'role', 'button', 'click', '--name', 'Resume session');
  await server.drivers.settled(id);
  assert.equal(await readJob(id, j => j.status), 'planned');
  assert.equal(calls, 4);
  writeFileSync(join(proof, 'verification.json'), JSON.stringify({ fixtureSdk: true, actualImpeccable: true, modelCalls: 0, sdkQueries: calls, status: 'planned', previewSeparateWindowTarget: true, anchoredTurns: true, streamingReadingPosition: true, ime: true, failedSendRecovery: true, reconnect: true, interruptResume: true, themes: ['dark', 'light'], widths: [1440, 390], reducedMotion: true }, null, 2));
  console.log(JSON.stringify({ proof, fixtureSdk: true, actualImpeccable: true, modelCalls: 0, status: 'planned' }));
} catch (error) {
  if (id) writeFileSync(join(proof, 'failure-state.json'), JSON.stringify(await readJob(id, job => ({ calls, state: job.designSession.state, streaming: job.designSession.streamingText, messages: job.designSession.messages.map(message => ({ role: message.role, text: message.text.slice(0, 100) })) })), null, 2));
  await browser('screenshot', join(proof, 'failure.png'), '--full').catch(() => {});
  throw error;
} finally {
  releaseStream?.();
  await browser('close').catch(() => {});
  if (server) await server.close();
  if (native && nativeKey) await runNative(native, workspace, ['serve-question', '--stop', '--key', nativeKey]).catch(() => {});
  await store.close(); setStore(undefined); rmSync(root, { recursive: true, force: true });
}
