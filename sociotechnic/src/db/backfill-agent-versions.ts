


import { assertNoForeignDriver } from "../driverlock.ts";
import { SociotechnicError } from "../errors.ts";
import type { Job } from "../job.ts";



import { nowIso } from "../time.ts";
import { loadJobHistory } from "./listing.ts";
import { currentStore } from "./store.ts";
import { mutateJob } from "../job-store.ts";

export function attributeBaselineVersions(job: Job, before: string, at: string): number {
  let count = 0;
  for (const dispatch of job.dispatches) {
    if (dispatch.configuration?.version || dispatch.versionBackfill || !dispatch.finishedAt) continue;
    const started = Date.parse(dispatch.startedAt);
    if (!Number.isFinite(started) || started > Date.parse(before)) continue;
    dispatch.versionBackfill = { version: "1.0.0", source: "operator-confirmed", at, before };
    count += 1;
  }
  return count;
}

export async function backfillAgentVersions({ before, confirm = false }: { before: string; confirm?: boolean }) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(before) || !Number.isFinite(Date.parse(before))) {
    throw new SociotechnicError("usage", "--before must be an explicit UTC timestamp, such as 2026-10-24T21:57:23.000Z");
  }
  const store = currentStore();
  if (!store) throw new SociotechnicError("db-disabled", "Version backfill requires the database release catalog");
  const history = await loadJobHistory();
  if (history.warnings.length) throw new SociotechnicError("backfill-history", history.warnings.join("; "));
  const at = nowIso(), cutoff = new Date(before).toISOString();
  const releases = new Set((await store.agentVersions()).filter((r) => r.version === "1.0.0").map((r) => r.agent));
  const jobs: { job: string; dispatches: number }[] = [];
  for (const snapshot of history.jobs) {
    const preview = structuredClone(snapshot);
    const count = attributeBaselineVersions(preview, cutoff, at);
    if (!count) continue;
    for (const dispatch of preview.dispatches) if (dispatch.versionBackfill?.at === at && !releases.has(dispatch.agent)) {
      throw new SociotechnicError("agent-version-conflict", `Missing database release ${dispatch.agent} v1.0.0`);
    }
    await assertNoForeignDriver(snapshot.id, process.pid);
    jobs.push({ job: snapshot.id, dispatches: count });
  }
  if (!confirm) return { applied: false, before: cutoff, version: "1.0.0", dispatches: jobs.reduce((sum, j) => sum + j.dispatches, 0), jobs };
  const applied: typeof jobs = [];
  for (const entry of jobs) await mutateJob(entry.job, async (job) => {
    await assertNoForeignDriver(entry.job, process.pid);
    const dispatches = attributeBaselineVersions(job, cutoff, at);
    if (dispatches) applied.push({ job: job.id, dispatches });
  });
  return { applied: true, before: cutoff, version: "1.0.0", dispatches: applied.reduce((sum,j) => sum+j.dispatches,0), jobs: applied };
}
