import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Job } from "../job.ts";
import { ensureJobAuthority } from "../job-store.ts";
import { statusLine } from "../engine.ts";
import { requireStore } from "./store.ts";
import type { JobFilter } from "./store.ts";
import { driverState } from "../driverlock.ts";
export type ListQuery = { project?: string | null; status?: string | null; limit?: number | null };
function filterOf(q: ListQuery): JobFilter {
  const status = q.status ?? null;
  const limit = q.limit ?? null;
  const raw = q.project?.trim() ?? "";
  if (raw === "") return { status, limit };
  if (!raw.includes("/")) return { project: raw, status, limit };
  const abs = resolve(raw);
  const repos = new Set([abs]);
  try {
    repos.add(realpathSync(abs));
  } catch {}
  return { repos: [...repos], status, limit };
}

export function entryFor(job: Job, worktreePresent: boolean) {
  return {
    ...statusLine(job),
    id: job.id,
    project: basename(job.repo),
    repo: job.repo,
    feature: job.feature,
    round: job.round,
    tier: job.plan?.tier ?? null,
    branch: job.branch,
    updatedAt: job.updatedAt,
    worktreePresent,
    archived: job.archived === true,
  };
}


export async function loadJobHistory(filter: JobFilter = {}): Promise<{source: "db"; jobs: Job[]; warnings: string[]}> {
  await ensureJobAuthority();
  return { source: "db", jobs: (await requireStore().listJobs(filter)).map((r) => r.job), warnings: [] };
}
export async function listJobs(q: ListQuery = {}) {
  await ensureJobAuthority();
  const rows = await requireStore().listJobs(filterOf(q));
  return { source: "db" as const, jobs: await Promise.all(rows.map(async (row) => ({ ...entryFor(row.job, existsSync(row.job.worktree)), driver: await driverState(row.id) }))) };
}
export async function listProjects() { await ensureJobAuthority(); return { source: "db" as const, projects: await requireStore().listProjects() }; }
