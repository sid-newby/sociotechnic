import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { versionRole, isAgentVersion } from "../src/agent-version-data.ts";
import type { AgentConfiguration } from "../src/agent-catalog.ts";
import type { DispatchOut } from "../src/engine.ts";
import { roleOf } from "../src/roles.ts";
import { parseSkillResources } from "../src/agent-skills.ts";
import { runnerFromEnv } from "./runner.ts";
import { runChecks } from "../src/checks.ts";
import type { Check } from "../src/config.ts";
import { VM_DISPATCHES, VM_HOME, VM_REPO } from "../src/sandbox.ts";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(): never { throw new Error("Invalid sandbox worker request"); }
const string = (v: unknown): string => typeof v === "string" ? v : fail();
const strings = (v: unknown): string[] => Array.isArray(v) && v.every((s): s is string => typeof s === "string") ? v : fail();

function configuration(value: unknown, fallbackRole: string): AgentConfiguration | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !isAgentVersion(value.version) || (value.revision !== null && typeof value.revision !== "string")) fail();
  const baseRole = string(value.baseRole ?? value.agentName ?? fallbackRole);
  const role = versionRole(roleOf(baseRole), value);
  return { version: value.version, revision: value.revision, ...role, skills: strings(value.skills), baseRole, ...(value.skillResources === undefined ? {} : { skillResources: parseSkillResources(value.skillResources) }), ...(value.agentName === undefined ? {} : { agentName: string(value.agentName) }), ...(value.releaseDigest === undefined ? {} : { releaseDigest: string(value.releaseDigest) }), ...(value.definition === undefined ? {} : { definition: string(value.definition) }) };
}

export function parseSandboxEntry(raw: unknown): DispatchOut {
  if (!object(raw) || !/^d-[a-zA-Z0-9-]+$/.test(string(raw.id)) || !Number.isFinite(Date.parse(string(raw.deadlineAt)))) fail();
  const agent = string(raw.agent);
  let designScope: DispatchOut["designScope"];
  if (raw.designScope !== undefined) {
    if (!object(raw.designScope)) fail();
    designScope = { record: string(raw.designScope.record), artifacts: string(raw.designScope.artifacts), receipt: string(raw.designScope.receipt), ...(raw.designScope.referenceRoot === undefined ? {} : { referenceRoot: string(raw.designScope.referenceRoot) }) };
  }
  return { id: string(raw.id), agent, model: string(raw.model), effort: string(raw.effort), deadlineAt: string(raw.deadlineAt), record: string(raw.record), prompt: string(raw.prompt), configuration: configuration(raw.configuration, agent), workerConfiguration: configuration(raw.workerConfiguration, "sociotechnic-comment-sicko"), ...(designScope ? { designScope } : {}) };
}

export function workerSnapshot(repo = VM_REPO): { head: string; dirty: boolean; branch: string } {
  const git = (...args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  return { head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--untracked-files=all") !== "", branch: git("branch", "--show-current") };
}

export type WorkerPaths = { home: string; repo: string; dispatches: string };
export async function sandboxWorker(command: string | undefined, requestPath?: string, paths: WorkerPaths = { home: VM_HOME, repo: VM_REPO, dispatches: VM_DISPATCHES }): Promise<void> {
  if (command === "snapshot") { process.stdout.write(JSON.stringify(workerSnapshot(paths.repo)) + "\n"); return; }
  const raw: unknown = JSON.parse(readFileSync(string(requestPath), "utf8"));
  if (!object(raw)) fail();
  if (command === "checks") {
    const commit = string(raw.commit);
    const before = workerSnapshot(paths.repo);
    if (before.head !== commit || before.dirty) throw new Error("Sandbox checks require a clean pinned commit");
    if (!Array.isArray(raw.checks)) fail();
    const checks: Check[] = raw.checks.map((v: unknown) => {
      if (!object(v) || typeof v.timeoutSeconds !== "number" || !Number.isFinite(v.timeoutSeconds) || v.timeoutSeconds <= 0) fail();
      return { name: string(v.name), run: string(v.run), timeoutSeconds: v.timeoutSeconds };
    });
    const report = await runChecks(checks, paths.repo, commit);
    const after = workerSnapshot(paths.repo);
    if (after.head !== commit || after.dirty || after.branch !== before.branch) throw new Error("Sandbox checks changed the repository");
    process.stdout.write(JSON.stringify(report) + "\n"); return;
  }
  if (command !== "run") fail();
  const entry = parseSandboxEntry(raw.entry);
  const scope = `${paths.dispatches}/${entry.id}`;
  const base = roleOf(entry.configuration?.baseRole ?? entry.agent);
  const role = entry.configuration ? versionRole({ ...base, name: entry.agent }, entry.configuration) : base;
  if (process.env.SOCIOTECHNIC_RUNNER !== "fake") {
    if (role.provider === "codex" && process.env.SBX_CRED_OPENAI_MODE !== "oauth") throw new Error("Sandbox provider requires an OAuth subscription binding; API-key fallback is disabled");
    if (role.provider === "claude") {
      // An interactive login can happen after creation, while the original
      // mode environment variable still says none. Trust only proxy sentinels.
      const credentials: unknown = JSON.parse(readFileSync(join(homedir(), ".claude/.credentials.json"), "utf8"));
      if (process.env.SBX_CRED_ANTHROPIC_MODE === "apikey" || !object(credentials) || !object(credentials.claudeAiOauth) || credentials.claudeAiOauth.accessToken !== "sk-ant-oat01-proxy-managed" || credentials.claudeAiOauth.refreshToken !== "sk-ant-ort01-proxy-managed") throw new Error("Claude requires Docker-managed subscription OAuth; API-key fallback is disabled");
    }
  }
  const abort = new AbortController();
  process.once("SIGTERM", () => abort.abort());
  const emit = (kind: string, message: string): void => { process.stdout.write(JSON.stringify({ kind, message }) + "\n"); };
  const result = await runnerFromEnv().run(entry, role, {
    sociotechnicHome: paths.home, repo: paths.repo, worktree: paths.repo, sandboxed: true, jobId: string(raw.jobId), round: typeof raw.round === "number" && Number.isInteger(raw.round) ? raw.round : fail(),
    inputRoot: `${scope}/inputs`, outputRoot: `${scope}/outputs`, recordPath: `${scope}/outputs/${entry.record}`,
    signal: abort.signal, onActivity: (line) => emit("activity", line), onWarn: (line) => emit("warning", line),
  });
  writeFileSync(join(scope, "result.json"), JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sandboxWorker(process.argv[2], process.argv[3]).catch(() => { process.stderr.write("Sandbox worker failed; inspect runtime setup and provider login.\n"); process.exitCode = 1; });
}
