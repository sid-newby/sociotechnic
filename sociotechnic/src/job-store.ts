import * as git from "./git.ts";
import { canonicalJson } from "./agent-version-data.ts";
import { validateJobAgentVersions } from "./agent-versions.ts";
import { deriveEvents } from "./db/events.ts";
import { requireStore } from "./db/store.ts";
import type { Store } from "./db/store.ts";
import { SociotechnicError } from "./errors.ts";
import { parseExecution } from "./execution.ts";
import { assertSandboxPreserved, removeSandbox } from "./sandbox.ts";
import { assertStatus } from "./job.ts";
import type { Job } from "./job.ts";
import { recordSession } from "./record-store.ts";
import type { RecordSession } from "./record-store.ts";
const jobJson = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value)));

import { nowIso } from "./time.ts";

async function operation<T>(id: string | null, fn: (job: Job | null) => T | Promise<T>, write: boolean, store: Store, effectKind?: string): Promise<T> {
  await ensureJobAuthority(store);
  const lease = write ? await store.lock(`operation:${id ?? "new"}`) : null;
  try {
    const snapshot = await store.transaction(async (tx) => {
      const job = id === null ? null : await tx.storedJob(id);
      if (id !== null && !job) throw new SociotechnicError("not-found", `Unknown job: ${id}`);
      return { job, records: id === null ? [] : await tx.records(id) };
    });
    let previous = snapshot.job ? structuredClone(snapshot.job) : null;
    const state: RecordSession = { job: snapshot.job, records: new Map(snapshot.records.map((r) => [r.path, r])), knownIds: new Set(id === null ? (await store.listJobs({})).map((j) => j.id) : [id]) };
    return await recordSession.run(state, async () => {
      // A creation callback establishes the job before using it.
      if (write && state.job?.externalOperation && state.job.externalOperation.kind !== effectKind) throw new SociotechnicError("reconcile-required", `Retry the interrupted ${state.job.externalOperation.kind} operation before changing this job`);
      const result = await fn(state.job);
      if (previous === null && state.reservation) previous = state.reservation;
      if (!write) return result;
      if (lease?.signal.aborted) throw new SociotechnicError("ownership-lost", "Database operation ownership was lost");
      const job = state.job;
      if (!job) throw new SociotechnicError("not-found", "Operation created no job");
      parseExecution(job.execution);
      if (previous && canonicalJson(previous.execution ?? {kind:"local"}) !== canonicalJson(job.execution ?? {kind:"local"})) throw new SociotechnicError("execution-pinned", "A run's execution setting cannot change after creation");
      await store.transaction(async (tx) => {
        await lease?.verify();
        for (const guard of state.commitGuards ?? []) await guard();
        const current = await tx.storedJob(job.id);
        if (jobJson(current) !== jobJson(previous) || canonicalJson((await tx.records(job.id)).sort((a,b)=>a.path.localeCompare(b.path))) !== canonicalJson(snapshot.records.sort((a,b)=>a.path.localeCompare(b.path)))) throw new SociotechnicError("stale-job", "Job changed during this operation; refresh before retrying");
        await validateJobAgentVersions(tx, job, current);
        if (job.designReleaseMigration && !current?.designReleaseMigration) {
          const migration = job.designReleaseMigration;
          await tx.rebindUnusedDesigner(job.id, job.agentAssignments?.["sociotechnic-designer"] ?? "sociotechnic-designer", migration.from, migration.to);
        }
        await tx.upsertJob(job);
        await tx.linkAgentVersions(job.id, job.agentVersions ?? {}, job.agentAssignments);
        for (const dispatch of job.dispatches) if (dispatch.step === 'research' && dispatch.configuration?.version && dispatch.agent !== (job.agentAssignments?.['sociotechnic-researcher'] ?? 'sociotechnic-researcher')) {
          const slot = `dispatch:${dispatch.id}`;
          await tx.linkAgentVersions(job.id, { [slot]: dispatch.configuration.version }, { [slot]: dispatch.agent });
        }
        const old = new Map(snapshot.records.map((r) => [r.path, r]));
        for (const [path, record] of state.records) {
          if (path === "job.json") continue;
          if (canonicalJson(old.get(path) ?? null) !== canonicalJson(record)) await tx.upsertRecord(job.id, record);
          old.delete(path);
        }
        for (const path of old.keys()) await tx.deleteRecord(job.id, path);
        await tx.insertEvents(job.id, deriveEvents(previous, job, nowIso()));
        await tx.notify(job.id);
        await lease?.verify();
        for (const guard of state.commitGuards ?? []) await guard();
      });
      return result;
    });
  } finally { await lease?.release(); }
}
export function readJob<T>(id: string, fn: (job: Job) => T | Promise<T>, store = requireStore()): Promise<T> { return operation(id, (job) => { if (!job) throw new SociotechnicError("not-found", `Unknown job ${id}`); return fn(job); }, false, store); }
export function mutateJob<T>(id: string, fn: (job: Job) => T | Promise<T>, store = requireStore()): Promise<T> { return operation(id, (job) => { if (!job) throw new SociotechnicError("not-found", `Unknown job ${id}`); return fn(job); }, true, store); }
export function createJobOperation<T>(fn: () => T | Promise<T>, store = requireStore()): Promise<T> { return operation(null, fn, true, store); }

export async function ensureJobAuthority(store = requireStore()): Promise<void> {
  if(store.kind === "pg" && !(await store.migration("job-authority-v1"))) throw new SociotechnicError("migration-required", "Run db import-jobs before using database-only jobs");
}

export async function reserveCreation(job: Job): Promise<void> {
  const state = recordSession.getStore();
  if (!state || state.job?.id !== job.id) throw new SociotechnicError("job-context-required", "Creation requires a database operation");
  const store = requireStore();
  await store.transaction(async (tx) => {
    if (await tx.storedJob(job.id)) throw new SociotechnicError("job-exists", "Job ID already exists");
    await validateJobAgentVersions(tx, job);
    await tx.upsertJob(job);
    await tx.linkAgentVersions(job.id,job.agentVersions ?? {},job.agentAssignments);
    await tx.insertEvents(job.id,deriveEvents(null,job,nowIso()));
    await tx.notify(job.id);
  });
  state.reservation = structuredClone(job);
}
export async function effectJob<T>(id: string, kind: string, fn: (job: Job) => T | Promise<T>, store = requireStore()): Promise<T> {
  const invoke = <R>(callback: (job: Job) => R | Promise<R>) => operation(id,(job) => {if(!job)throw new SociotechnicError("not-found",`Unknown job ${id}`);return callback(job);},true,store,kind);
  await invoke((job) => { if (!job.externalOperation) job.externalOperation={id:crypto.randomUUID(),kind,at:nowIso(),...(kind === "merge" ? {head:git.resolveCommit(job.repo,job.branch),baseHead:git.headCommit(job.repo)} : {})}; });
  try { return await invoke(async (job) => {
    if (kind === "clean") { assertStatus(job,["merged","stopped"],"clean"); await removeSandbox(job); }
    if (kind === "merge" && job.status === "accepted") await assertSandboxPreserved(job);
    const result=await fn(job);
    if (kind === "merge" && job.status === "merged") await removeSandbox(job);
    if (kind === "merge-remote" && job.status === "merged" && job.execution?.kind === "docker-sandbox") {
      try { await removeSandbox(job); job.statusReason = `merged on GitHub${job.pr?.merge ? ` as ${job.pr.merge.commit}` : ""}; sandbox removed; local checkout unchanged`; }
      catch (error) { job.statusReason += `; sandbox cleanup failed: ${error instanceof Error ? error.message : "unknown failure"}. Use Sandboxes to retry cleanup.`; }
    }
    job.lastOperation=job.externalOperation;delete job.externalOperation;return result;
  }); }
  catch(error) {
    if(error instanceof SociotechnicError && (["illegal-transition","no-github-remote","gh-unavailable","confirm-required","accept-required","no-pull-request","stale-confirmation","invalid-pr","pr-repository-mismatch","pr-identity-mismatch","pr-head-changed","pr-not-open","worktree-dirty","not-on-base","base-dirty","dirty-tree","wrong-branch","already-merged","merge-conflict","driver-active","no-branch"].includes(error.code) || (kind === "clean" && error.code === "sandbox-preservation")))await invoke((job)=>{delete job.externalOperation;});
    throw error;
  }
}
