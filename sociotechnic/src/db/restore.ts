import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as git from "../git.ts";
import type { Job } from "../job.ts";
import { assertJobId } from "../paths.ts";
import { effectJob, ensureJobAuthority } from "../job-store.ts";
import { requireStore } from "./store.ts";
import type { Store } from "./store.ts";
import { SociotechnicError } from "../errors.ts";
export type RestoreResult = { job: string; worktree: "restored" | "present" | "no-branch" };
function worktreeRegistered(repo: string, path: string): boolean {
  const forms = new Set([path]);
  try {
    forms.add(join(realpathSync(dirname(path)), basename(path)));
  } catch {}
  const out = git.git(repo, ["worktree", "list", "--porcelain"]);
  return out.split("\n").some((l) => l.startsWith("worktree ") && forms.has(l.slice("worktree ".length)));
}

export function restoreWorktree(job: Job): RestoreResult["worktree"] {
  if (existsSync(job.worktree)) return "present";
  if (!existsSync(job.repo)) return "no-branch";
  if (!git.branchExists(job.repo,job.branch) && job.creation?.state === "pending") { git.addWorktree(job.repo,job.branch,job.worktree,job.base.commit); return "restored"; }
  if (!git.branchExists(job.repo, job.branch)) return "no-branch";
  if (worktreeRegistered(job.repo, job.worktree)) git.git(job.repo, ["worktree", "prune"]);
  mkdirSync(dirname(job.worktree), { recursive: true });
  git.git(job.repo, ["worktree", "add", job.worktree, job.branch]);
  return "restored";
}


export async function restoreJob(id: string, force = false, store: Store = requireStore()): Promise<RestoreResult> {
  assertJobId(id);
  if (force) throw new SociotechnicError("usage", "restore --force was removed; database records are authoritative");
  await ensureJobAuthority(store);
  const coordination = await store.lock(`driver:${id}`).catch((error: unknown) => {
    if(error instanceof SociotechnicError && error.code === "locked")throw new SociotechnicError("driver-active","A driver owns this job; recovery was refused");
    throw error;
  });
  try {
    if(await store.driver(id))throw new SociotechnicError("driver-active","Stop or reconcile the previous driver before recovering its worktree");
    return await effectJob(id,"restore",(job)=>{
      const worktree=restoreWorktree(job);
      if(worktree!=="no-branch" && job.creation)job.creation.state="complete";
      return {job:id,worktree};
    },store);
  } finally { await coordination.release(); }
}
