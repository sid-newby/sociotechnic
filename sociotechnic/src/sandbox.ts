import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { requireStore } from "./db/store.ts";
import { SociotechnicError } from "./errors.ts";
import type { DockerExecution } from "./execution.ts";
import type { Job } from "./job.ts";
import * as git from "./git.ts";
import { sociotechnicHome } from "./paths.ts";
import type { Check } from "./config.ts";
import type { ChecksReport } from "./checks.ts";

export const VM_ROOT = "/home/agent/sociotechnic";
export const VM_REPO = `${VM_ROOT}/repo`;
export const VM_GIT = `${VM_ROOT}/repository.git`;
export const VM_HOME = `${VM_ROOT}/control`;
export const VM_WORKER = `${VM_HOME}/sociotechnic/ui/sandbox-worker.ts`;
export const VM_DISPATCHES = `${VM_ROOT}/dispatches`;
const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function sandboxName(id: string, home = sociotechnicHome()): string {
  if (!/^[0-9]{8}-[a-z0-9][a-z0-9-]*$/.test(id)) throw new SociotechnicError("bad-job-id", "Invalid sandbox job ID");
  const owner = createHash("sha256").update(realpathSync(home)).digest("hex").slice(0, 12);
  return `sociotechnic-${owner}-${id}`;
}
function ownerPrefix(): string { return sandboxName("20000101-owner").replace("20000101-owner", ""); }
function statePath(id: string): string { return join(sociotechnicHome(), ".sociotechnic/sandboxes", `${sandboxName(id)}.json`); }
function recipePath(id: string): string { return statePath(id).replace(/\.json$/, ".env.yaml"); }
function environmentArgs(job: SandboxJob): string[] {
  return [recipePath(job.id), "--env-arg", `name=${sandboxName(job.id)}`, "--env-arg", `cpus=${job.execution.cpus}`, "--env-arg", `memoryGiB=${job.execution.memoryGiB}`];
}
function error(message: string): never { throw new SociotechnicError("sandbox", message); }

// Host commands never receive provider credentials or the database URL.
export function sandboxEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "SBX_NO_TELEMETRY"]) if (process.env[key]) env[key] = process.env[key];
  env.DOCKER_SANDBOXES_DOCKER_SIZE = "6g";
  return env;
}
export type CommandOptions = { signal?: AbortSignal; timeoutMs?: number; input?: string; onLine?: (line: string) => void };
export async function sbx(args: readonly string[], options: CommandOptions = {}): Promise<string> {
  if (options.signal?.aborted) error("Sandbox operation cancelled");
  return new Promise((done, reject) => {
    const child = spawn(process.env.SOCIOTECHNIC_SBX || "sbx", args, { env: sandboxEnvironment(), detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let output = "", pending = "", bytes = 0, failure: string | null = null;
    const kill = (): void => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {} };
    const cancel = (): void => { failure = "Sandbox operation cancelled"; kill(); };
    const timer = setTimeout(() => { failure = "Sandbox operation timed out"; kill(); }, options.timeoutMs ?? TIMEOUT_MS);
    options.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { failure = "Sandbox output limit exceeded"; kill(); return; }
      output += chunk.toString(); pending += chunk.toString();
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const line of lines) options.onLine?.(line);
    });
    // Diagnostics can contain authentication details. Keep them out of run records.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
    child.on("error", () => { failure = "Cannot start sbx. Install Docker Sandboxes and sign in with sbx login."; });
    child.on("close", (code) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
      if (failure || code !== 0) reject(new SociotechnicError("sandbox", failure ?? `sbx ${args[0]} failed (exit ${String(code)}). Inspect this sandbox with sbx; host execution was refused.`));
      else done(output);
    });
    if (options.signal?.aborted) cancel();
  });
}
export async function vmExec(id: string, command: readonly string[], options: CommandOptions = {}): Promise<string> {
  try { return await sbx(["exec", sandboxName(id), ...command], options); }
  catch (failure) {
    if (options.signal?.aborted || (failure instanceof Error && /timed out|output limit/.test(failure.message))) {
      try { await sbx(["stop", sandboxName(id)]); } catch { error("Sandbox execution ended, but remote termination was not confirmed. Inspect it with sbx before continuing."); }
    }
    throw failure;
  }
}

export async function ownedSandboxes(): Promise<string[]> {
  const names = (await sbx(["ls", "--quiet"])).split(/\r?\n/).filter(Boolean);
  return names.filter((name) => name.startsWith(ownerPrefix()));
}
function setting(name: string, fallback: number, min: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min) error(`${name} must be an integer >= ${min}`);
  return value;
}
export function checkSandboxDisk(): void {
  const disk = statfsSync(sociotechnicHome());
  const floor = setting("SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB", 15, 1);
  if (disk.bavail * disk.bsize < floor * 1024 ** 3) error(`Sandbox provisioning needs at least ${floor} GiB free. Free space or adjust the operator setting before retrying.`);
}

function runtimeArchive(home: string, destination: string): void {
  const paths = git.git(home, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter((path) =>
    path.startsWith("sociotechnic/src/") || /^sociotechnic\/ui\/[^/]+\.ts$/.test(path) || path.startsWith("sociotechnic/hooks/") || path.startsWith("sociotechnic/seeds/") || path.startsWith("sociotechnic/skills/") || path.startsWith("sociotechnic/scaffolds/") || path.startsWith(".claude/skills/") || path.startsWith(".agents/skills/") || ["sociotechnic/package.json", "sociotechnic/pnpm-lock.yaml", "sociotechnic/pnpm-workspace.yaml", "sociotechnic/ui/web/package.json"].includes(path)).filter((path) => !path.split("/").some((part) => [".git", "node_modules", "dist"].includes(part) || (part.startsWith(".env") && part !== ".env.example")));
  for (const path of paths) if (!lstatSync(join(home, path)).isFile()) error(`Sandbox runtime requires regular source files: ${path}`);
  execFileSync("tar", ["-cf", destination, "-C", home, "--null", "-T", "-"], { input: paths.join("\0") + "\0", stdio: ["pipe", "pipe", "pipe"] });
}
function manifest(id: string): { initialized: boolean } {
  if (!existsSync(statePath(id))) return { initialized: false };
  const raw: unknown = JSON.parse(readFileSync(statePath(id), "utf8"));
  if (!object(raw) || raw.name !== sandboxName(id) || typeof raw.initialized !== "boolean") error("Sandbox ownership manifest is invalid");
  return { initialized: raw.initialized };
}
function writeManifest(id: string, initialized: boolean): void {
  mkdirSync(dirname(statePath(id)), { recursive: true });
  writeFileSync(statePath(id), JSON.stringify({ name: sandboxName(id), initialized }), { mode: 0o600 });
}

export type SandboxJob = Pick<Job, "id" | "repo" | "worktree" | "branch"> & { execution: DockerExecution };
export async function ensureSandbox(job: SandboxJob, signal?: AbortSignal): Promise<void> {
  const lock = await requireStore().lock(`sandbox-capacity:${ownerPrefix()}`);
  try {
    const names = await ownedSandboxes();
    const name = sandboxName(job.id);
    const state = manifest(job.id);
    if (names.includes(name) && !existsSync(statePath(job.id))) error("A sandbox with this name exists without an ownership manifest; inspect it before retrying");
    if (names.includes(name) && state.initialized) return;
    if (!names.includes(name) && state.initialized) error("The run's sandbox is missing. It may contain unexported work; explicit recovery is required.");
    checkSandboxDisk();
    if (!names.includes(name)) {
      if (names.length >= setting("SOCIOTECHNIC_SANDBOX_MAX_RETAINED", 1, 1)) error("Sandbox capacity reached. Finish or remove a retained Sociotechnic sandbox before starting another; stopped sandboxes also count.");
      writeManifest(job.id, false);
      if (!existsSync(recipePath(job.id))) writeFileSync(recipePath(job.id), readFileSync(join(sociotechnicHome(), "sociotechnic/sandbox-kit/sbxenv.yaml")), { mode: 0o600 });
      const args = ["env", "create", ...environmentArgs(job), "--force"];
      await sbx(args, { signal, timeoutMs: 15 * 60_000 });
    }
    const temporary = mkdtempSync(join(tmpdir(), "sociotechnic-sandbox-"));
    try {
      if (git.porcelain(job.worktree, true) !== "") error("The host review worktree must be clean before sandbox provisioning");
      const seed = join(temporary, "seed.bundle"), runtime = join(temporary, "runtime.tar");
      git.git(job.worktree, ["bundle", "create", seed, "HEAD"]);
      runtimeArchive(sociotechnicHome(), runtime);
      await vmExec(job.id, ["mkdir", "-p", VM_ROOT, VM_HOME], { signal });
      await sbx(["cp", seed, `${name}:${VM_ROOT}/seed.bundle`], { signal });
      await sbx(["cp", runtime, `${name}:${VM_ROOT}/runtime.tar`], { signal });
      // Initialization can be retried without overwriting a clone or its edits.
      await vmExec(job.id, ["sh", "-c", `test -d '${VM_GIT}' || git clone --bare '${VM_ROOT}/seed.bundle' '${VM_GIT}'`], { signal });
      const checkout = (await vmExec(job.id, ["sh", "-c", `if test -e '${VM_REPO}/.git'; then echo present; else echo missing; fi`], { signal })).trim();
      if (checkout === "missing") {
        const exists = (await vmExec(job.id, ["git", "--git-dir", VM_GIT, "branch", "--list", job.branch], { signal })).trim() !== "";
        await vmExec(job.id, ["git", "--git-dir", VM_GIT, "worktree", "add", ...(exists ? [VM_REPO, job.branch] : ["-b", job.branch, VM_REPO, "HEAD"])], { signal });
      }
      const branch = (await vmExec(job.id, ["git", "-C", VM_REPO, "branch", "--show-current"], { signal })).trim();
      if (branch !== job.branch) await vmExec(job.id, ["git", "-C", VM_REPO, "checkout", "-b", job.branch], { signal });
      await vmExec(job.id, ["git", "-C", VM_REPO, "remote", "remove", "origin"], { signal }).catch(() => {});
      await vmExec(job.id, ["git", "-C", VM_REPO, "config", "user.name", "Sociotechnic agent"], { signal });
      await vmExec(job.id, ["git", "-C", VM_REPO, "config", "user.email", "agent@sociotechnic.invalid"], { signal });
      await vmExec(job.id, ["tar", "-xf", `${VM_ROOT}/runtime.tar`, "-C", VM_HOME], { signal });
      await vmExec(job.id, ["sh", "-c", `node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' && command -v git && command -v codex && test -z "$SSH_AUTH_SOCK"`], { signal });
      await vmExec(job.id, ["sh", "-c", `test "$(pnpm --version 2>/dev/null)" = 12.15.0 || npm install --global pnpm@12.15.0 --ignore-scripts --no-fund --no-audit`], { signal, timeoutMs: 5 * 60_000 });
      await vmExec(job.id, ["sh", "-c", `cd '${VM_HOME}/sociotechnic' && pnpm install --frozen-lockfile --prod --filter sociotechnic --ignore-scripts`], { signal, timeoutMs: 10 * 60_000 });
      await vmExec(job.id, ["rm", "-f", `${VM_ROOT}/seed.bundle`, `${VM_ROOT}/runtime.tar`], { signal });
      writeManifest(job.id, true);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  } finally { await lock.release(); }
}

export function sandboxJob(job: Job): SandboxJob | null {
  return job.execution?.kind === "docker-sandbox" ? { ...job, execution: job.execution } : null;
}
export async function sandboxHead(id: string): Promise<{ head: string; dirty: boolean; branch: string }> {
  const result: unknown = JSON.parse(await vmExec(id, ["node", VM_WORKER, "snapshot"]));
  if (!object(result) || typeof result.head !== "string" || !/^[0-9a-f]{40,64}$/.test(result.head) || typeof result.dirty !== "boolean" || typeof result.branch !== "string") error("Invalid sandbox Git snapshot");
  return { head: result.head, dirty: result.dirty, branch: result.branch };
}
export async function importSandboxCommit(job: Pick<Job, "id" | "worktree" | "branch">): Promise<void> {
  const state = await sandboxHead(job.id);
  if (state.branch !== job.branch) error("Sandbox changed its assigned branch; work was retained for inspection");
  if (state.dirty) error("Sandbox has uncommitted changes; work was retained and cannot pass the gate");
  if (git.currentBranch(job.worktree) !== job.branch || git.porcelain(job.worktree, true) !== "") error("Host review worktree changed; sandbox import was refused");
  const previous = git.headCommit(job.worktree);
  if (state.head === previous) return;
  const temporary = mkdtempSync(join(tmpdir(), "sociotechnic-import-"));
  try {
    const bundle = join(temporary, "result.bundle");
    await vmExec(job.id, ["git", "-C", VM_REPO, "bundle", "create", `${VM_ROOT}/result.bundle`, "HEAD", `^${previous}`]);
    await sbx(["cp", `${sandboxName(job.id)}:${VM_ROOT}/result.bundle`, bundle]);
    git.git(job.worktree, ["-c", "core.hooksPath=/dev/null", "fetch", "--no-tags", "--no-recurse-submodules", bundle, "HEAD"]);
    if (git.resolveCommit(job.worktree, "FETCH_HEAD") !== state.head || !git.isAncestor(job.worktree, previous, state.head)) error("Sandbox result is not a descendant of the host review commit");
    // No sandbox Git config, hooks, dependency tree or arbitrary files are copied.
    git.git(job.worktree, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", state.head]);
    if (git.headCommit(job.worktree) !== state.head || git.porcelain(job.worktree, true) !== "") error("Sandbox import did not produce the verified clean commit");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function runSandboxChecks(job: SandboxJob, checks: readonly Check[], commit: string, signal?: AbortSignal): Promise<ChecksReport> {
  await ensureSandbox(job, signal);
  const state = await sandboxHead(job.id);
  if (state.head !== commit || state.dirty || state.branch !== job.branch) error("Sandbox checks require the exact clean host review commit");
  const temporary = mkdtempSync(join(tmpdir(), "sociotechnic-checks-"));
  try {
    const path = join(temporary, "checks.json");
    writeFileSync(path, JSON.stringify({ checks, commit }));
    await sbx(["cp", path, `${sandboxName(job.id)}:${VM_ROOT}/checks.json`], { signal });
    const timeoutMs = checks.reduce((sum, check) => sum + check.timeoutSeconds * 1000, 60_000);
    const raw: unknown = JSON.parse(await vmExec(job.id, ["node", VM_WORKER, "checks", `${VM_ROOT}/checks.json`], { timeoutMs, signal }));
    if (!object(raw) || raw.commit !== commit || typeof raw.pass !== "boolean" || typeof raw.configured !== "boolean" || typeof raw.ranAt !== "string" || !Array.isArray(raw.results) || raw.results.length !== checks.length) error("Invalid sandbox checks report");
    const results = raw.results.map((value: unknown, index) => {
      const check = checks[index];
      if (!object(value) || value.name !== check.name || value.run !== check.run || (value.exitCode !== null && !Number.isInteger(value.exitCode)) || (value.signal !== null && typeof value.signal !== "string") || typeof value.timedOut !== "boolean" || typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || typeof value.tail !== "string" || value.pass !== (!value.timedOut && value.exitCode === 0)) error("Invalid sandbox check result");
      return { name: check.name, run: check.run, exitCode: typeof value.exitCode === "number" ? value.exitCode : null, signal: typeof value.signal === "string" ? value.signal : null, timedOut: value.timedOut, durationMs: value.durationMs, tail: value.tail, pass: value.pass };
    });
    await importSandboxCommit(job);
    if (git.headCommit(job.worktree) !== commit) error("Repository checks changed the sandbox commit");
    return { commit, configured: checks.length > 0, pass: results.every((r) => r.pass), ranAt: raw.ranAt, results };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function stopSandbox(job: Pick<Job, "id" | "execution">): Promise<void> {
  if (job.execution?.kind !== "docker-sandbox" || !existsSync(statePath(job.id))) return;
  if ((await ownedSandboxes()).includes(sandboxName(job.id))) await sbx(["stop", sandboxName(job.id)]);
}
export async function assertSandboxPreserved(job: Job): Promise<void> {
  if (!sandboxJob(job)) return;
  const present = (await ownedSandboxes()).includes(sandboxName(job.id));
  if (!present) return;
  const refuse = (message: string): never => { throw new SociotechnicError("sandbox-preservation", message); };
  if (!existsSync(statePath(job.id))) refuse("Sandbox ownership manifest is missing; automatic deletion was refused");
  if (manifest(job.id).initialized) {
    const state = await sandboxHead(job.id);
    const merged = job.status === "merged" || (job.externalOperation?.kind === "merge" && job.externalOperation.head === state.head);
    const ref = git.branchExists(job.repo, job.branch) ? job.branch : merged ? job.base.branch : null;
    if (state.dirty || state.branch !== job.branch || ref === null || !git.isAncestor(job.repo, state.head, ref)) refuse("Sandbox removal refused: preserve its clean assigned branch on the host first");
  } else {
    refuse("Sandbox setup was interrupted. Inspect and recover its files before removing it manually with sbx rm; automatic deletion was refused.");
  }
}
export async function removeSandbox(job: Job): Promise<void> {
  const sandbox = sandboxJob(job);
  if (!sandbox) return;
  await assertSandboxPreserved(job);
  if ((await ownedSandboxes()).includes(sandboxName(job.id))) await sbx(["env", "rm", ...environmentArgs(sandbox), "--force"]);
  if ((await ownedSandboxes()).includes(sandboxName(job.id))) error("Sandbox removal was not confirmed");
  rmSync(statePath(job.id), { force: true });
  rmSync(recipePath(job.id), { force: true });
}

export async function assertSandboxMirror(job: Job): Promise<void> {
  if (!sandboxJob(job)) return;
  const state = await sandboxHead(job.id);
  if (state.head !== git.headCommit(job.worktree) || state.dirty || state.branch !== job.branch) error("Sandbox and host review commit differ; the gate was refused");
}

export async function removeSandboxDispatch(job: Pick<Job, "id" | "execution">, dispatch: string): Promise<void> {
  if (job.execution?.kind !== "docker-sandbox") return;
  if (!/^d-[a-zA-Z0-9-]+$/.test(dispatch)) error("Invalid dispatch cleanup scope");
  await vmExec(job.id, ["rm", "-rf", "--", `${VM_DISPATCHES}/${dispatch}`]);
}
