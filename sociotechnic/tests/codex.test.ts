import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Dispatch } from "../src/job.ts";
import { roleOf } from "../src/roles.ts";
import { ROLES } from "../src/roles.ts";
import { CODEX_MODELS, effortChoices, supportsCodexReader } from "../src/agent-models.ts";
import { versionRole } from "../src/agent-version-data.ts";
import { bundledAgentDefinition } from "../src/agents.ts";
import { usageByRole } from "../src/usage.ts";
import { parseProfiles } from "../ui/web/src/model.ts";
import { tokenUsage } from "../ui/web/src/token-usage.ts";
import { codexArgs, codexEnvironment, codexRunner, codexUsage } from "../ui/codex-runner.ts";
import { readerTools } from "../ui/codex-read-tools.ts";
import type { RunContext } from "../ui/runner.ts";
import { runnerFromEnv } from "../ui/runner.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("Codex readers reject traversal, symlink escapes, writes and oversized reads", () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-reader-test-"));
  try {
    const allowed = join(root, "allowed"); mkdirSync(allowed);
    writeFileSync(join(allowed, "text.txt"), "first\nneedle\nthird\n");
    writeFileSync(join(root, "secret"), "secret");
    writeFileSync(join(allowed, "big"), "x".repeat(2_000_001));
    symlinkSync(join(root, "secret"), join(allowed, "escape"));
    const call = readerTools([allowed]);
    assert.match(call("read_file", { path: "text.txt", offset: 2, limit: 1 }), /^2: needle/);
    assert.match(call("grep", { path: allowed, pattern: "needle" }), /text.txt:2: needle/);
    assert.match(call("glob", { path: allowed, pattern: "**/*.txt" }), /text.txt/);
    for (const path of ["../secret", "escape"]) assert.throws(() => call("read_file", { path }), /outside/);
    assert.throws(() => call("read_file", { path: "big" }), /2 MB/);
    assert.throws(() => call("write_file", { path: allowed, pattern: "x" }), /Unknown/);
    assert.throws(() => call("read_file", { path: "text.txt", offset: 0 }), /offset/);
    assert.equal(readFileSync(join(root, "secret"), "utf8"), "secret");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Codex usage counts cache once and leaves unreported measurements absent", () => {
  const usage = codexUsage({ input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 });
  assert.deepEqual(tokenUsage({ usage }), { input: 40, output: 10, cacheRead: 60, cacheWrite: null, total: 110 });
  assert.equal(codexUsage({ input_tokens: 10, cached_input_tokens: 20, output_tokens: 1 }), null);
  assert.equal(codexUsage({ input_tokens: 10 }), null);
});

test("Codex role bindings and network tools are explicit", () => {
  assert.equal(roleOf("sociotechnic-reviewer-code").model, "gpt-6.1-sol");
  assert.equal(roleOf("sociotechnic-researcher").model, "gpt-6-luna");
  assert.equal(roleOf("sociotechnic-builder").provider, "claude");
  const review = codexArgs("gpt-6.1-sol", "high", "/tmp/test", null, false);
  assert.ok(review.includes('web_search="disabled"'));
  assert.ok(review.includes("features.code_mode_host=true"));
  assert.ok(review.includes('mcp_servers.sociotechnic.enabled_tools=["read_file","glob","grep"]'));
  assert.ok(review.includes('mcp_servers.sociotechnic.tools.read_file.approval_mode="approve"'));
  const research = codexArgs("gpt-6-luna", "high", "/tmp/test", { type: "http", url: "https://example.invalid/mcp", headers: { "X-Key": "not-secret" } }, true);
  assert.ok(research.includes('web_search="live"'));
  assert.ok(!research.join(" ").includes("not-secret"));
  assert.equal(codexEnvironment("/tmp/test", { type: "http", url: "https://example.invalid", headers: { "X-Key": "not-secret" } }).SOCIOTECHNIC_CONTEXT7_HEADER_0, "not-secret");
  const profiles = parseProfiles({ roles: [roleOf("sociotechnic-reviewer-code")], agents: { ok: true } });
  assert.equal(profiles.roles[0].provider, "codex");
  assert.deepEqual(profiles.roles[0].tools, ["read_file", "glob", "grep"]);
  assert.ok(research.includes('mcp_servers.context7.enabled_tools=["resolve-library-id","query-docs"]'));
});

test("Codex subprocess and real MCP write only successful records; bounds kill subprocess groups", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-codex-test-"));
  const old = { ...process.env };
  try {
    delete process.env.SOCIOTECHNIC_RUNNER;
    process.env.SOCIOTECHNIC_CODEX = join(HERE, "fixtures", "fake-codex.mjs");
    process.env.OPENAI_API_KEY = "must-not-inherit";
    process.env.CODEX_API_KEY = "must-not-inherit";
    process.env.CODEX_ACCESS_TOKEN = "must-not-inherit";
    writeFileSync(join(root, "evidence.txt"), "evidence\n");
    const home = join(root, "home");
    mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    mkdirSync(join(home, ".sociotechnic", "jobs", "fixture"), { recursive: true });
    const abort = new AbortController();
    const activity:string[]=[], warnings:string[]=[];
    const ctx: RunContext = { inputRoot: root, outputRoot: root, sociotechnicHome: home, repo: root, worktree: root, jobId: "fixture", round: 1, recordPath: join(root, "record.md"), signal: abort.signal, onActivity: (line) => activity.push(line), onWarn: (line) => warnings.push(line) };
    for (const name of ["sociotechnic-reviewer-code", "sociotechnic-researcher"]) {
      const role = roleOf(name);
      const entry = { id: "d-001", agent: name, model: role.model, effort: "high", record: "record.md", prompt: "Read evidence.txt and write your record.", deadlineAt: new Date(Date.now() + 10_000).toISOString() };
      const result = await runnerFromEnv().run(entry, role, ctx);
      assert.equal(result.outcome, "ok", result.note ?? "");
      assert.match(readFileSync(ctx.recordPath, "utf8"), name.endsWith("researcher") ? /^STATUS: DONE/ : /^VERDICT: PASS/);
      rmSync(ctx.recordPath);
      process.env.SOCIOTECHNIC_CODEX_TEST_MODE = "at-budget";
      const exact = await codexRunner().run(entry, role, ctx);
      assert.equal(exact.outcome, "ok", exact.note ?? "");
      assert.ok(activity.some((line) => line.includes(`tool operations ${role.maxTurns}/${role.maxTurns}, 0 remaining`)));
      assert.ok(warnings.some((line) => line.includes("1 operation remaining")));
      assert.ok(warnings.some((line) => line.includes("0 operations remaining")));
      rmSync(ctx.recordPath);
      for (const mode of ["failed", "budget", "over-budget", "forbidden"]) {
        process.env.SOCIOTECHNIC_CODEX_TEST_MODE = mode;
        const result = await codexRunner().run(entry, role, ctx);
        assert.equal(result.outcome, "failed", mode);
        assert.equal(existsSync(ctx.recordPath), false, mode);
      }
      delete process.env.SOCIOTECHNIC_CODEX_TEST_MODE;
    }
    const role = roleOf("sociotechnic-reviewer-code");
    process.env.SOCIOTECHNIC_CODEX_TEST_MODE = "hang";
    const pidPath = join(root, "child.pid");
    process.env.SOCIOTECHNIC_CODEX_TEST_PID = pidPath;
    const entry = { id: "d-002", agent: role.name, model: role.model, effort: "high", record: "record.md", prompt: "hang", deadlineAt: new Date(Date.now() + 600).toISOString() };
    assert.equal((await codexRunner().run(entry, role, ctx)).outcome, "timeout");
    const childPid = Number(readFileSync(pidPath, "utf8"));
    for (let i = 0; i < 30; i++) { try { process.kill(childPid, 0); await sleep(20); } catch { break; } }
    assert.throws(() => process.kill(childPid, 0));
    entry.deadlineAt = new Date(Date.now() + 10_000).toISOString();
    const pending = codexRunner().run(entry, role, ctx);
    setTimeout(() => abort.abort(), 100);
    assert.equal((await pending).note, "stopped by human");
    assert.equal(existsSync(ctx.recordPath), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    rmSync(root, { recursive: true, force: true });
  }
});

test("usage groups historical and current role bindings separately", () => {
  const base: Dispatch = { id: "d-001", round: 1, step: "review", lens: "reviewer-code", attempt: 1, agent: "sociotechnic-reviewer-code", model: "sonnet", effort: "high", record: "record.md", startedAt: "", deadlineAt: "", finishedAt: "", outcome: "ok", parsed: null, usage: { total_tokens: 10 }, note: null };
  const rows = usageByRole([base, { ...base, model: "gpt-6.1-sol", usage: { total_tokens: 20 } }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.model, r.usage.total_tokens]), [["sonnet", 10], ["gpt-6.1-sol", 20]]);
});

test("switched and custom readers route every supported OpenAI model with template network permissions", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-switched-codex-")), old = { ...process.env };
  try {
    delete process.env.SOCIOTECHNIC_RUNNER;
    process.env.SOCIOTECHNIC_CODEX = join(HERE, "fixtures", "fake-codex.mjs");
    writeFileSync(join(root, "evidence.txt"), "evidence\n");
    mkdirSync(join(root, ".sociotechnic/jobs/fixture"), { recursive: true });
    const ctx: RunContext = { inputRoot: root, outputRoot: root, sociotechnicHome: root, repo: root, worktree: root, jobId: "fixture", round: 1, recordPath: join(root, "record.md"), signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} };
    for (const [index, base] of ROLES.filter(supportsCodexReader).entries()) {
      const model = CODEX_MODELS[index % CODEX_MODELS.length];
      for (const effort of effortChoices(model)) {
        const role = versionRole(base, { ...base, model, effort });
        const configuration = { ...role, agentName: "sociotechnic-custom-reader", baseRole: base.name, version: "1.0.0", revision: null, definition: bundledAgentDefinition(base.name), skills: [] };
        const entry = { id: "d-switched", agent: configuration.agentName, model, effort, configuration, record: "record.md", prompt: "Read evidence.txt and return your record.", deadlineAt: new Date(Date.now() + 10_000).toISOString() };
        process.env.SOCIOTECHNIC_CODEX_TEST_NETWORK = base.tools.includes("WebSearch") ? "live" : "disabled";
        process.env.SOCIOTECHNIC_CODEX_TEST_MODEL = model;
        process.env.SOCIOTECHNIC_CODEX_TEST_EFFORT = effort;
        const result = await runnerFromEnv().run(entry, { ...role, name: entry.agent }, ctx);
        assert.equal(result.outcome, "ok", `${base.name}: ${result.note ?? ""}`);
        assert.ok(existsSync(ctx.recordPath)); rmSync(ctx.recordPath);
        await assert.rejects(codexRunner().run({ ...entry, configuration: { ...configuration, tools: [...base.tools, "Bash"] } }, role, ctx), /baseline allowance/);
      }
    }
    const builder = roleOf("sociotechnic-designer");
    await assert.rejects(codexRunner().run({ id: "d-no", agent: builder.name, model: "gpt-6-sol", effort: "high", record: "record.md", prompt: "", deadlineAt: new Date(Date.now() + 10_000).toISOString() }, builder, ctx), /Unsupported Codex role/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old); rmSync(root, { recursive: true, force: true });
  }
});


test("Codex builders enable worktree execution and count edits and shell calls; skill references stay available", async () => {
  const root = mkdtempSync(join(tmpdir(), "sociotechnic-builder-test-")), old = { ...process.env };
  try {
    process.env.SOCIOTECHNIC_CODEX = join(HERE, "fixtures/fake-codex.mjs");
    process.env.SOCIOTECHNIC_CODEX_TEST_NETWORK = "live";
    process.env.SOCIOTECHNIC_CODEX_TEST_SKILLS = "1";
    writeFileSync(join(root, "evidence.txt"), "evidence\n");
    const repo = join(root, "repo"), worktree = join(root, "worktree"); mkdirSync(repo);
    writeFileSync(join(repo, "README.md"), "fixture");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: "pipe" });
    git("init", "-b", "main"); git("add", "."); git("commit", "-m", "Fixture"); git("worktree", "add", "-b", "sociotechnic/fixture", worktree);
    const base = roleOf("sociotechnic-builder"), role = versionRole(base, { ...base, model: "gpt-6.1-sol" });
    const configuration = { ...role, baseRole: base.name, version: "1.0.0", revision: null, definition: bundledAgentDefinition(base.name), skills: ["fixture-skill"], skillResources: [{ name: "fixture-skill", files: { "SKILL.md": "# Fixture skill", "references/detail.md": "Pinned reference evidence" } }] };
    const ctx: RunContext = { sociotechnicHome: root, repo: root, worktree, inputRoot: root, outputRoot: root, jobId: "fixture", round: 1, recordPath: join(root, "build.md"), signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} };
    const entry = { id: "d-build", agent: role.name, model: role.model, effort: role.effort, configuration, record: "build.md", prompt: "Build the fixture", deadlineAt: new Date(Date.now() + 10000).toISOString() };
    const result = await codexRunner().run(entry, role, ctx);
    assert.equal(result.outcome, "ok", result.note ?? "");
    assert.equal(readFileSync(join(worktree, "built.txt"), "utf8"), "built\n");
    assert.match(readFileSync(ctx.recordPath, "utf8"), /^STATUS: READY/);
    assert.equal(typeof result.usage === "object" && result.usage !== null && "tool_uses" in result.usage ? result.usage.tool_uses : null, 3);
    rmSync(ctx.recordPath);
    const bounded = { ...entry, configuration: { ...configuration, maxTurns: 2 } };
    assert.equal((await codexRunner().run(bounded, role, ctx)).outcome, "failed");
    assert.equal(existsSync(ctx.recordPath), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old); rmSync(root, { recursive: true, force: true });
  }
});
