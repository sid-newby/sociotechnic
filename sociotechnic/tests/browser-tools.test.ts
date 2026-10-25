import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { assertBrowserToolchain, BROWSER_TOOLS, browserEnvironment, closeBrowserSessions, installBrowserTools, needsBrowserTools, verifyBrowserTools } from "../ui/browser-tools.ts";
import { bundledSkills } from "../src/agent-skills.ts";
import { agentCatalogEntry } from "../src/agent-catalog.ts";
import { roleOf } from "../src/roles.ts";
import { runnerFromEnv, sdkRunner } from "../ui/runner.ts";
import { codexEnvironment } from "../ui/codex-runner.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-browser-test-"));
const oldPath = process.env.PATH;
const log = join(root, "calls.jsonl"), installed = join(root, "installed");
const source = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
const name=path.basename(process.argv[1]), args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({name,args,session:process.env.AGENT_BROWSER_SESSION,devtools:process.env.CD4A_INTERNAL_DAEMON_SESSION_ID})+'\\n');
if(args.includes('--version')) { console.log(process.env.BROWSER_TEST_WRONG_VERSION || (name==='agent-browser'?'0.39.2':'1.12.0')); process.exit(0); }
if(args.includes('doctor')) { const missing=process.env.BROWSER_TEST_NO_CHROME && !fs.existsSync(${JSON.stringify(installed)}); console.log(JSON.stringify({checks:missing?[]:[{id:'chrome.installed',status:'pass',message:'Chrome at '+process.execPath},{id:'launch.elapsed',status:'pass',message:'Launched'}]})); process.exit(0); }
if(args.includes('install')) fs.writeFileSync(${JSON.stringify(installed)},'ready');
if(args.includes('stop')&&process.env.BROWSER_TEST_STOP_FAILURE)process.exit(1);
`;
for (const name of ["agent-browser", "chrome-devtools", "npm", "sudo", "apt-get"]) writeFileSync(join(root, name), source, { mode: 0o755 });
process.env.PATH = `${root}:${oldPath ?? ""}`;
after(() => { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
const calls = (): { name: string; args: string[]; session?: string; devtools?: string }[] => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("packaged browser instructions pin the verified tools without granting a role permission", () => {
  const base = agentCatalogEntry(roleOf("sociotechnic-builder-lite")).configuration;
  assert.equal(needsBrowserTools(base), false);
  assert.equal(needsBrowserTools({ ...base, skills: ["browser-verification"] }), false);
  const resources = bundledSkills(["browser-verification"]);
  assert.equal(needsBrowserTools({ ...base, skillResources: resources }), true);
  assertBrowserToolchain({ ...base, skillResources: resources });
  const older = structuredClone(resources); older[0].files["toolchain.json"] = '{"agent-browser":"0.0.1","chrome-devtools-mcp":"1.12.0"}';
  assert.throws(() => assertBrowserToolchain({ ...base, skillResources: older }), /matching runtime/);
  assert.match(resources[0].files["references/devtools.md"], /SOCIOTECHNIC_BROWSER_EXECUTABLE_PATH/);
  assert.deepEqual(BROWSER_TOOLS.map((tool) => tool.version), ["0.39.2", "1.12.0"]);
  assert.equal(roleOf("sociotechnic-planner").tools.includes("Bash"), false);
});

test("preflight checks actual CLI output and Chrome launch, and installation repairs a missing runtime", () => {
  assert.equal(verifyBrowserTools(), process.execPath);
  process.env.BROWSER_TEST_WRONG_VERSION = "0.0.0";
  try { assert.throws(verifyBrowserTools, /task browser:install/); }
  finally { delete process.env.BROWSER_TEST_WRONG_VERSION; }
  process.env.BROWSER_TEST_NO_CHROME = "1";
  try {
    assert.throws(verifyBrowserTools, /Chrome could not launch/);
    installBrowserTools();
    assert.equal(verifyBrowserTools(), process.execPath);
    assert.ok(calls().some((call) => call.args.includes("install")));
  } finally { delete process.env.BROWSER_TEST_NO_CHROME; }
});

test("Linux ARM64 installs system Chromium with its sandbox and reuses a healthy runtime", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  assert.ok(platform && arch);
  rmSync(installed, { force: true });
  process.env.BROWSER_TEST_NO_CHROME = "1";
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "arm64" });
  try {
    const start = calls().length;
    installBrowserTools();
    const setup = calls().slice(start);
    const command = process.getuid?.() === 0 ? "apt-get" : "sudo";
    const prefix = command === "apt-get" ? [] : ["-n", "apt-get"];
    assert.deepEqual(setup.filter((call) => call.name === command).map((call) => call.args), [
      [...prefix, "update"],
      [...prefix, "install", "-y", "--no-install-recommends", "chromium", "chromium-sandbox"],
    ]);
    assert.equal(setup.some((call) => call.name === "agent-browser" && call.args.includes("install")), false);
    const ready = calls().length;
    installBrowserTools();
    assert.equal(calls().slice(ready).some((call) => call.args.includes("install") || call.args.includes("update")), false);
  } finally {
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "arch", arch);
    delete process.env.BROWSER_TEST_NO_CHROME;
  }
});

test("session ownership is stable within a dispatch and distinct across engines, jobs and dispatches", () => {
  const env = browserEnvironment("engine", "job", "d-1", root, process.execPath);
  assert.deepEqual(env, browserEnvironment("engine", "job", "d-1", root, process.execPath));
  for (const values of [["other", "job", "d-1"], ["engine", "other", "d-1"], ["engine", "job", "d-2"]]) assert.notEqual(browserEnvironment(values[0], values[1], values[2]).AGENT_BROWSER_SESSION, env.AGENT_BROWSER_SESSION);
  assert.match(env.CD4A_INTERNAL_DAEMON_SESSION_ID, /^[a-f0-9]{24}$/);
  assert.equal(env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, "1");
  assert.equal(codexEnvironment(root, null, env).AGENT_BROWSER_SESSION, env.AGENT_BROWSER_SESSION);
  const warnings: string[] = [];
  closeBrowserSessions(env, (message) => warnings.push(message));
  const last = calls().slice(-2);
  assert.deepEqual(last.map((call) => call.args), [["--session", env.AGENT_BROWSER_SESSION, "close"], ["--sessionId", env.CD4A_INTERNAL_DAEMON_SESSION_ID, "stop"]]);
  assert.equal(warnings.length, 0);
  process.env.BROWSER_TEST_STOP_FAILURE = "1";
  try { closeBrowserSessions(env, (message) => warnings.push(message)); assert.match(warnings[0], /cleanup could not confirm chrome-devtools/); }
  finally { delete process.env.BROWSER_TEST_STOP_FAILURE; }
});

test("Claude receives the same browser environment and read-only roles cannot run the skill", async () => {
  const role = roleOf("sociotechnic-builder-lite"), configuration = agentCatalogEntry(role).configuration;
  const browserEnv = browserEnvironment(root, "job", "d-sdk", root, process.execPath);
  const ctx = { sociotechnicHome: root, repo: root, worktree: root, jobId: "job", round: 1, recordPath: join(root, "build.md"), signal: new AbortController().signal, onActivity() {}, onWarn() {}, browserEnv };
  const entry = { id: "d-sdk", agent: role.name, model: role.model, effort: role.effort, record: "round-1/build.md", prompt: "Verify", deadlineAt: new Date(Date.now() + 30_000).toISOString(), configuration };
  let observed = false;
  await sdkRunner(async function* ({ options }) { observed = true; assert.equal(options.env?.AGENT_BROWSER_SESSION, browserEnv.AGENT_BROWSER_SESSION); assert.equal(options.env?.CD4A_INTERNAL_DAEMON_SESSION_ID, browserEnv.CD4A_INTERNAL_DAEMON_SESSION_ID); }).run(entry, role, ctx);
  assert.equal(observed, true);
  const reader = roleOf("sociotechnic-planner");
  const readerEntry = { ...entry, agent: reader.name, model: reader.model, effort: reader.effort, configuration: { ...agentCatalogEntry(reader).configuration, skillResources: bundledSkills(["browser-verification"]) } };
  const result = await runnerFromEnv().run(readerEntry, reader, ctx);
  assert.equal(result.outcome, "failed");
  assert.match(result.note ?? "", /existing Bash permission/);
});
