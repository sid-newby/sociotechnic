import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { agentCatalogEntry, catalogEntry } from "../src/agent-catalog.ts";
import type { AgentConfiguration } from "../src/agent-catalog.ts";
import { bundledAgentDefinition, parseFrontmatter } from "../src/agents.ts";
import { versionRole } from "../src/agent-versions.ts";
import { parseAgentVersion, releaseContentDigest, releaseDigest } from "../src/agent-version-data.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import type { DispatchOut } from "../src/engine.ts";
import { addDispatch, createJob, saveJob } from "../src/job.ts";
import { createJobOperation } from "../src/job-store.ts";
import { jobDir } from "../src/paths.ts";
import { writeTextAtomic } from "../src/record-store.ts";
import { roleOf } from "../src/roles.ts";
import type { Role } from "../src/roles.ts";
import { ingestDispatch, prepareDispatch, stagedRecord } from "../src/staging.ts";
import type { StagedDispatch } from "../src/staging.ts";
import { fixtureGitHead, seedStagedJobContext } from "./helpers/staged-job-context.ts";
import { sdkOptions, sdkRunner } from "../ui/runner.ts";

const home = realpathSync(mkdtempSync(join(tmpdir(), "sociotechnic-runner-envelope-")));
const oldHome = process.env.SOCIOTECHNIC_HOME, oldConfig = process.env.SOCIOTECHNIC_CLAUDE_CONFIG;
const id = "20261025-runner-envelope", commit = fixtureGitHead(home,`sociotechnic/${id}`);
process.env.SOCIOTECHNIC_HOME = home;
process.env.SOCIOTECHNIC_CLAUDE_CONFIG = join(home, "missing-claude.json");
cpSync(new URL("../hooks/", import.meta.url), join(home, "sociotechnic/hooks"), { recursive: true });
mkdirSync(join(home, "src"));
let store = createMemoryStore();
after(async () => {
  await releaseDriver(id, process.pid);
  setStore(undefined);
  if (oldHome === undefined) delete process.env.SOCIOTECHNIC_HOME;
  else process.env.SOCIOTECHNIC_HOME = oldHome;
  if (oldConfig === undefined) delete process.env.SOCIOTECHNIC_CLAUDE_CONFIG;
  else process.env.SOCIOTECHNIC_CLAUDE_CONFIG = oldConfig;
  rmSync(home, { recursive: true, force: true });
});

type Fixture = { role: Role; configuration?: AgentConfiguration };
function fixture(baseName: string, kind: "fallback" | "legacy" | "custom"): Fixture {
  const base = roleOf(baseName);
  if (kind === "fallback") return { role: base };
  const configuration = agentCatalogEntry(base).configuration;
  if (kind === "legacy") return { role: base, configuration };
  configuration.agentName = `sociotechnic-custom-${base.record}`;
  configuration.baseRole = base.name;
  configuration.tools = base.record === "build" ? ["Read", "Grep", "Glob", "Bash", "Edit", "Write"] : ["Read", "Grep", "Glob", "Write"];
  configuration.maxTurns = 17;
  configuration.definition = `---\nname: ${configuration.agentName}\ndescription: Custom frozen fixture\n---\n\n  Preserve this exact body, whitespace and legacy obligations.\nRead .sociotechnic/jobs/<job>/plan.md and write the assigned job folder report.\nRun the full repository suite when assigned to build.\n\n`;
  return { configuration, role: versionRole({ ...base, name: configuration.agentName }, configuration) };
}

async function stages(f: Fixture, count = 1) {
  await releaseDriver(id, process.pid);
  rmSync(join(home, ".sociotechnic"), { recursive: true, force: true });
  store = createMemoryStore();
  setStore(store);
  if (f.configuration) {
    const configuration = f.configuration, template = configuration.baseRole;
    const release = parseAgentVersion({ ...roleOf(template ?? f.role.name), name: f.role.name }, {
      version: configuration.version, role: f.role, definition: configuration.definition,
      digest: releaseDigest(f.role, configuration.definition ?? ""), label: "Isolated envelope fixture", createdAt: null,
      ...(template ? { template, distinctPurpose: "Exercise frozen custom envelope instructions" } : {}),
      ...(configuration.skillResources ? { skillResources: configuration.skillResources } : {}),
    });
    await store.transaction((tx) => tx.insertAgentVersion({ agent: f.role.name, version: release.version,
      contentDigest: releaseContentDigest(release), release }));
    f.configuration = catalogEntry(release).configuration;
  }
  const envelopes: DispatchOut[] = [];
  const now = new Date().toISOString();
  await createJobOperation(() => {
    const job = createJob({ id, feature: "Simplify ordinary dispatch envelopes", repo: home, worktree: home,
      branch: `sociotechnic/${id}`, base: { branch: "main", commit },
      caps: { rounds: 3, dispatchesPerRound: 10, retriesPerStep: 1 }, now });
    const builder = f.role.record === "build";
    job.status = builder ? "building" : "reviewing";
    saveJob(job);
    writeTextAtomic(join(jobDir(id), "plan.md"), "committed plan evidence\n");
    for (let n = 0; n < count; n += 1) {
      const record = builder ? `round-${n + 1}/build.md` : `round-${n + 1}/review-ux.md`;
      const d = addDispatch(job, { round: n + 1, step: builder ? "build" : "review", lens: builder ? null : "reviewer-ux",
        attempt: 1, agent: f.role.name, model: f.role.model, effort: f.role.effort, record,
        timeoutMinutes: f.role.timeoutMinutes }, now);
      if (f.configuration) d.configuration = f.configuration;
      const envelope: DispatchOut = { id: d.id, agent: d.agent, model: d.model, effort: d.effort, record,
        deadlineAt: d.deadlineAt, ...(f.configuration ? { configuration: f.configuration } : {}),
        prompt: `Read ${join(jobDir(id), "plan.md")}. Write ${join(jobDir(id), record)}.` };
      d.execution = { envelope, launch: "pending" };
      envelopes.push(envelope);
    }
    seedStagedJobContext(job,count,!builder);
  });
  const token = await acquireDriver(id, { pid: process.pid, startedAt: now, mode: "step", owner: "ui" });
  const result: StagedDispatch[] = [];
  for (const envelope of envelopes) result.push(await prepareDispatch(id, envelope, token));
  return result;
}

async function hookResult(options: Options, matcher: string, tool: string, path: string) {
  const hook = options.hooks?.PreToolUse?.find((entry) => entry.matcher === matcher)?.hooks[0];
  assert.ok(hook);
  return hook({ session_id: "fixture", transcript_path: "", cwd: home, hook_event_name: "PreToolUse",
    tool_name: tool, tool_use_id: "fixture", tool_input: tool === "Read" || tool === "Write" || tool === "Edit" ? { file_path: path } : { path } },
  "fixture", { signal: new AbortController().signal });
}

async function assertScopes(options: Options, stage: StagedDispatch, role: Role) {
  const selected = options.agents?.[role.name];
  assert.ok(selected);
  assert.deepEqual(selected.tools, [...role.tools]);
  assert.deepEqual(options.allowedTools, [...role.tools]);
  assert.deepEqual(options.tools, role.tools.filter((tool) => !tool.startsWith("mcp__")));
  const baseline = roleOf(stage.entry.configuration?.baseRole ?? role.name);
  assert.deepEqual(options.disallowedTools, baseline.tools.filter((tool) => !role.tools.includes(tool)));
  assert.equal(selected.maxTurns, role.maxTurns);
  assert.equal(options.env?.SOCIOTECHNIC_INPUT_ROOT, stage.inputs);
  assert.equal(options.env?.SOCIOTECHNIC_OUTPUT_ROOT, stage.outputs);
  assert.deepEqual(await hookResult(options, "Read|Grep|Glob", "Read", join(stage.inputs, "plan.md")), {});
  assert.deepEqual(await hookResult(options, "Read|Grep|Glob", "Read", stagedRecord(stage)), {});
  assert.deepEqual(await hookResult(options, "Read|Grep|Glob", "Glob", join(home, "src")), {});
  for (const path of [join(jobDir(id), "plan.md"), join(home, ".sociotechnic/backups/plan.md"), home]) {
    assert.notDeepEqual(await hookResult(options, "Read|Grep|Glob", "Read", path), {});
  }
  if (role.record === "build") {
    assert.ok(selected.tools?.includes("Bash") && selected.tools.includes("Edit"));
    assert.equal(options.hooks?.PreToolUse?.some((entry) => entry.matcher === "Write|Edit"), false);
  } else {
    assert.equal(selected.tools?.includes("Bash"), false);
    assert.equal(selected.tools?.includes("Edit"), false);
    assert.deepEqual(await hookResult(options, "Write|Edit", "Write", stagedRecord(stage)), {});
    for (const path of [join(stage.inputs, "plan.md"), join(home, "src/foreign.ts"), join(stage.outputs, "../escape.md")]) {
      assert.notDeepEqual(await hookResult(options, "Write|Edit", "Write", path), {});
    }
    const link = join(stage.outputs, "linked");
    symlinkSync(join(home, "src"), link);
    assert.notDeepEqual(await hookResult(options, "Write|Edit", "Write", join(link, "foreign.ts")), {});
    rmSync(link);
  }
}

async function run(f: Fixture, stage: StagedDispatch, output: string, inspect: (options: Options) => Promise<void> = async () => {}) {
  return sdkRunner(async function* ({ prompt, options }) {
    assert.equal(prompt, stage.entry.prompt);
    assert.equal((String(prompt).match(/Storage adapter:/g) ?? []).length, 1);
    assert.ok(String(prompt).includes(`Read the staged inputs at ${stage.inputs}`));
    assert.ok(String(prompt).includes(`Write only assigned outputs under ${stage.outputs}`));
    assert.ok(String(prompt).includes("Legacy instruction paths refer to this staging scope; no .sociotechnic/jobs directory is authoritative."));
    assert.ok(String(prompt).includes(join(stage.inputs, "plan.md")));
    assert.ok(String(prompt).includes(stagedRecord(stage)));
    await inspect(options);
    writeFileSync(stagedRecord(stage), output);
    yield { type: "result", subtype: "success", is_error: false, duration_ms: 10, num_turns: 1,
      total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [] } as unknown as SDKMessage;
  }).run(stage.entry, f.role, { sociotechnicHome: home, jobId: id, repo: home, worktree: home, round: 1,
    recordPath: stagedRecord(stage), inputRoot: stage.inputs, outputRoot: stage.outputs,
    signal: new AbortController().signal, onActivity: () => {}, onWarn: () => {} });
}

for (const base of ["sociotechnic-reviewer-ux", "sociotechnic-builder"]) {
  for (const kind of ["fallback", "legacy", "custom"] as const) {
    test(`${kind} ${base} preserves the profile across staged IDs and retains real scopes and ingestion`, async () => {
      const f = fixture(base, kind), pair = await stages(f, 2), profiles: string[] = [];
      const body = parseFrontmatter(f.configuration?.definition ?? bundledAgentDefinition(base))?.body;
      assert.ok(body);
      assert.notEqual(pair[0].entry.id, pair[1].entry.id);
      assert.notEqual(pair[0].entry.prompt, pair[1].entry.prompt);
      for (const stage of pair) {
        const output = `${f.role.record === "build" ? "STATUS: READY" : "VERDICT: PASS"}\nCOMMIT: ${commit}\n`;
        const result = await run(f, stage, output, async (options) => {
          profiles.push(options.agents?.[f.role.name].prompt ?? "");
          assert.equal(profiles.at(-1), body);
          assert.ok(!profiles.at(-1)?.includes(stage.root));
          await assertScopes(options, stage, f.role);
        });
        assert.equal(result.outcome, "ok", result.note ?? "runner failed");
        const finished = await ingestDispatch(id, stage, result);
        assert.equal(finished.parsed?.effective, f.role.record === "build" ? "READY" : "PASS");
        assert.equal((await store.records(id)).find((row) => row.path === stage.entry.record)?.text, output);
        assert.equal(existsSync(stage.root), false);
      }
      assert.equal(profiles[0], profiles[1]);
    });
  }

  test(`${base} malformed output remains malformed and staged-input or output violations refuse ingestion`, async () => {
    const f = fixture(base, "custom");
    for (const violation of ["malformed", "input", "output", "owner"] as const) {
      const [stage] = await stages(f);
      const result = await run(f, stage, "unstructured provider reply\n");
      assert.equal(result.outcome, "ok", result.note ?? "runner failed");
      if (violation === "malformed") {
        const finished = await ingestDispatch(id, stage, result);
        assert.equal(finished.parsed?.kind, "malformed");
        assert.notEqual(finished.parsed?.effective, f.role.record === "build" ? "READY" : "PASS");
        assert.equal((await store.records(id)).find((row) => row.path === stage.entry.record)?.text, "unstructured provider reply\n");
        continue;
      }
      if (violation === "input") writeFileSync(join(stage.inputs, "plan.md"), "changed evidence");
      if (violation === "output") writeFileSync(join(stage.outputs, "foreign.md"), "undeclared output");
      if (violation === "owner") await store.setDriver(id, { token: "replacement-owner" });
      await assert.rejects(ingestDispatch(id, stage, result), violation === "input" ? /input changed/i : violation === "output" ? /Undeclared output/ : /Stale driver completion/);
      assert.equal((await store.storedJob(id))?.dispatches[0].finishedAt, null);
      assert.equal((await store.records(id)).find((row) => row.path === stage.entry.record), undefined);
      assert.ok(existsSync(stage.root));
    }
  });
}

for (const agentTool of [true, false]) test(`comment coordinator ${agentTool ? "with" : "without"} Agent and nested worker keep their existing path-bearing profile adapter`, async () => {
  const f = fixture("sociotechnic-comment-cleaner", "legacy");
  if (!agentTool) {
    assert.ok(f.configuration);
    f.configuration.tools = f.role.tools.filter((tool) => tool !== "Agent");
    f.role = versionRole(f.role, f.configuration);
  }
  const [stage] = await stages(f);
  stage.entry.prompt += "\n\n## Team capabilities\nFrozen team fixture\n\n## Asking for help\nAsk the coordinator.";
  const expected = sdkOptions(stage.entry, f.role, home, new AbortController(), null);
  const adapter = `\n\nExecution storage adapter: PostgreSQL owns committed job state. Read job evidence from ${stage.inputs}; write assigned reports only under ${stage.outputs}. References in the preserved instructions to the job folder or .sociotechnic/jobs mean this dispatch staging scope. Target repository edits and other tools remain limited by your original role. Never edit staged inputs.\n`;
  const result = await run(f, stage, `STATUS: READY\nCOMMIT: ${commit}\n`, async (options) => {
    assert.deepEqual(Object.keys(options.agents ?? {}), Object.keys(expected.agents ?? {}));
    for (const [name, agent] of Object.entries(expected.agents ?? {})) {
      assert.deepEqual(options.agents?.[name], { ...agent, prompt: agent.prompt + adapter });
    }
    assert.deepEqual(options.tools, expected.tools);
    assert.deepEqual(options.allowedTools, expected.allowedTools);
  });
  assert.equal(result.outcome, "ok", result.note ?? "runner failed");
});

test("packaged skill references still append to the verbatim body and retain their temporary-path residual", async () => {
  const f = fixture("sociotechnic-reviewer-ux", "custom");
  assert.ok(f.configuration);
  f.configuration.skillResources = [{ name: "fixture-skill", files: { "SKILL.md": "Use the frozen fixture guidance.\n" } }];
  f.configuration.skills = ["fixture-skill"];
  const [stage] = await stages(f);
  let skillRoot = "";
  const result = await run(f, stage, `VERDICT: PASS\nCOMMIT: ${commit}\n`, async (options) => {
    const profile = options.agents?.[f.role.name].prompt ?? "";
    const body = parseFrontmatter(f.configuration?.definition ?? "")?.body ?? "";
    assert.ok(profile.startsWith(body + "\n\n# Pinned instruction skills\n"));
    assert.ok(profile.includes("Use the frozen fixture guidance."));
    assert.ok(!profile.includes("Execution storage adapter:"));
    skillRoot = /Reference directory: (.+)/.exec(profile)?.[1] ?? "";
    assert.ok(skillRoot.includes("sociotechnic-skills-"));
    assert.equal(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), "Use the frozen fixture guidance.\n");
    assert.deepEqual(options.agents?.[f.role.name].skills, []);
  });
  assert.equal(result.outcome, "ok", result.note ?? "runner failed");
  assert.equal(existsSync(skillRoot), false);
});
