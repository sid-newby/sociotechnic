import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DispatchOut } from "../src/engine.ts";
import type { RunContext, RunResult } from "./runner.ts";
import { ensureSandbox, importSandboxCommit, sandboxName, sbx, stopSandbox, VM_DISPATCHES, VM_HOME, VM_REPO, VM_WORKER, vmExec } from "../src/sandbox.ts";
import type { SandboxJob } from "../src/sandbox.ts";
import { STOPPED_NOTE } from "../src/job.ts";
import { copySandboxOutputs, sameSandboxInputs } from "./sandbox-outputs.ts";
import { assertBrowserToolchain, needsBrowserTools } from "./browser-tools.ts";

const initializing = new Map<string, Promise<void>>();
const running = new Map<string, { active: Set<Promise<void>>; waiting: number }>();
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function mapSandboxPaths(value: unknown, paths: readonly (readonly [string, string])[]): unknown {
  if (typeof value === "string") {
    // Replace once, longest first, so inserted sandbox paths are never remapped.
    const pattern = new RegExp(paths.map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    return value.replace(pattern, (match) => paths.find(([from]) => from === match)?.[1] ?? match);
  }
  if (Array.isArray(value)) return value.map((item: unknown) => mapSandboxPaths(item, paths));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapSandboxPaths(item, paths)]));
  return value;
}

export async function sandboxSlot<T>(name: string, limit: number, deadline: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const group = running.get(name) ?? { active: new Set<Promise<void>>(), waiting: 0 };
  running.set(name, group);
  const active = group.active;
  group.waiting++;
  try { while (active.size >= limit) {
    await new Promise<void>((done, reject) => {
      const cancel = (): void => { cleanup(); reject(new Error("Sandbox dispatch cancelled while waiting")); };
      const timer = setTimeout(cancel, Math.max(0, Date.parse(deadline) - Date.now()));
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
      signal.addEventListener("abort", cancel, { once: true });
      void Promise.race(active).then(() => { cleanup(); done(); });
      if (signal.aborted) cancel();
    });
  } } finally { group.waiting--; }
  if (signal.aborted || Date.parse(deadline) <= Date.now()) throw new Error("Sandbox dispatch cancelled or deadline reached");
  let release: () => void = () => {};
  const token = new Promise<void>((done) => { release = done; });
  active.add(token);
  try { return await fn(); } finally { active.delete(token); release(); if (active.size === 0 && group.waiting === 0) running.delete(name); }
}

export async function runInSandbox(entry: DispatchOut, original: RunContext): Promise<RunResult> {
  const ctx = { ...original, signal: AbortSignal.any([original.signal, AbortSignal.timeout(Math.max(1, Date.parse(entry.deadlineAt) - Date.now()))]) };
  if (ctx.execution?.kind !== "docker-sandbox") throw new Error("Sandbox runner requires a pinned Docker execution setting");
  if (!ctx.inputRoot || !ctx.outputRoot || !ctx.branch) throw new Error("Sandbox runner requires dispatch staging and an assigned branch");
  const job: SandboxJob = { id: ctx.jobId, repo: ctx.repo, worktree: ctx.worktree, branch: ctx.branch, execution: ctx.execution };
  const name = sandboxName(ctx.jobId);
  return sandboxSlot(name, ctx.execution.parallelAgents, entry.deadlineAt, ctx.signal, async () => {
    try {
      let preparation = initializing.get(name);
      if (!preparation) { preparation = ensureSandbox(job, ctx.signal); initializing.set(name, preparation); }
      try { await preparation; } finally { if (initializing.get(name) === preparation) initializing.delete(name); }
      if (needsBrowserTools(entry.configuration)) {
        if (!entry.configuration?.tools.includes("Bash")) throw new Error("Browser verification requires the pinned role's existing Bash permission");
        assertBrowserToolchain(entry.configuration);
        ctx.onActivity("preparing pinned browser tools inside the run sandbox");
        await vmExec(ctx.jobId, ["node", `${VM_HOME}/sociotechnic/ui/browser-tools.ts`, "--install"], { signal: ctx.signal, timeoutMs: Math.max(1, Date.parse(entry.deadlineAt) - Date.now()), onLine: ctx.onActivity });
      }
      ctx.onActivity(`sandbox ${name}: ${ctx.execution?.kind === "docker-sandbox" ? `${ctx.execution.cpus} CPUs, ${ctx.execution.memoryGiB} GiB` : ""}`);
      const scope = `${VM_DISPATCHES}/${entry.id}`;
      const paths: [string, string][] = [[ctx.outputRoot ?? "", `${scope}/outputs`], [ctx.inputRoot ?? "", `${scope}/inputs`], [ctx.worktree, VM_REPO], [ctx.repo, VM_REPO], [ctx.sociotechnicHome, VM_HOME]];
      paths.sort((a, b) => b[0].length - a[0].length);
      const temporary = mkdtempSync(join(tmpdir(), "sociotechnic-dispatch-"));
      try {
        const request = join(temporary, "request.json");
        const rewrite = (mapping: readonly (readonly [string, string])[]) => (bytes: Buffer): Buffer => {
          try { return Buffer.from(String(mapSandboxPaths(new TextDecoder("utf-8", { fatal: true }).decode(bytes), mapping))); } catch { return bytes; }
        };
        const expectedInputs = join(temporary, "inputs");
        copySandboxOutputs(ctx.inputRoot ?? "", expectedInputs, rewrite(paths));
        writeFileSync(request, JSON.stringify({ entry: mapSandboxPaths(entry, paths), jobId: ctx.jobId, round: ctx.round }));
        await vmExec(ctx.jobId, ["mkdir", "-p", scope, `${scope}/outputs`], { signal: ctx.signal });
        await sbx(["cp", expectedInputs, `${name}:${scope}/inputs`], { signal: ctx.signal });
        await sbx(["cp", ctx.outputRoot ?? "", `${name}:${scope}/outputs-seed`], { signal: ctx.signal });
        await sbx(["cp", request, `${name}:${scope}/request.json`], { signal: ctx.signal });
        await vmExec(ctx.jobId, ["sh", "-c", `cp -R '${scope}/outputs-seed/.' '${scope}/outputs/'`], { signal: ctx.signal });
        await vmExec(ctx.jobId, ["node", VM_WORKER, "run", `${scope}/request.json`], { signal: ctx.signal, timeoutMs: Math.max(1, Date.parse(entry.deadlineAt) - Date.now()), onLine(line) {
          try { const event: unknown = JSON.parse(line); if (object(event) && typeof event.message === "string") { if (event.kind === "activity") ctx.onActivity(event.message); if (event.kind === "warning") ctx.onWarn(event.message); } } catch {}
        } });
        await sbx(["cp", `${name}:${scope}/result.json`, join(temporary, "result.json")]);
        const result: unknown = JSON.parse(readFileSync(join(temporary, "result.json"), "utf8"));
        if (!object(result) || !["ok", "failed", "timeout"].includes(String(result.outcome)) || (result.note !== null && typeof result.note !== "string")) throw new Error("Invalid sandbox runner result");
        if (result.outcome === "ok") {
          const returnedInputs = join(temporary, "returned-inputs");
          await sbx(["cp", `${name}:${scope}/inputs`, returnedInputs]);
          if (!sameSandboxInputs(expectedInputs, returnedInputs)) throw new Error("Sandbox agent changed its staged inputs; completion was refused");
          await importSandboxCommit(job);
          const received = join(temporary, "outputs");
          await sbx(["cp", `${name}:${scope}/outputs`, received]);
          // Never let a sandbox copy operation write directly into canonical staging.
          copySandboxOutputs(received, ctx.outputRoot ?? "", rewrite(paths.map(([from, to]) => [to, from])));
        }
        return { outcome: result.outcome === "ok" ? "ok" : result.outcome === "timeout" ? "timeout" : "failed", usage: result.usage ?? null, note: result.note };
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    } catch (error) {
      // Closing the host exec process alone does not terminate a VM process.
      await stopSandbox(job).catch(() => ctx.onWarn("Sandbox stop was not confirmed; inspect it with sbx."));
      return { outcome: original.signal.aborted ? "failed" : Date.parse(entry.deadlineAt) <= Date.now() ? "timeout" : "failed", usage: null, note: original.signal.aborted ? STOPPED_NOTE : error instanceof Error ? error.message : "Sandbox execution failed" };
    }
  });
}
