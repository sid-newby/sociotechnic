import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDispatch } from "../../src/job.ts";
import type { Job } from "../../src/job.ts";
import { jobDir } from "../../src/paths.ts";
import { planDigest } from "../../src/plan.ts";
import { writeJsonAtomic, writeTextAtomic } from "../../src/record-store.ts";

/** Owned temp repository only; transport tests do not assert a workflow/gate pass. */
export function fixtureGitHead(home: string, branch: string): string {
  const git = (...args: string[]) => execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","core.fsmonitor=false","-C",home,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-b","main");
  git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","--allow-empty","-m","transport fixture");
  git("checkout","-b",branch);
  return git("rev-parse","HEAD");
}

/** Supply the real inputs that prepareDispatch now verifies before runner entry. */
export function seedStagedJobContext(job: Job, count: number, review: boolean): void {
  const plan = JSON.parse(readFileSync(new URL("../../schemas/plan.schema.json",import.meta.url),"utf8")).examples[0];
  job.plan = {digest:planDigest(plan),tier:"EASY",pinnedAt:job.createdAt,researchRound:0};
  job.round = count;
  writeJsonAtomic(join(jobDir(job.id),"plan.json"),plan);
  for (let n=1;n<=count;n++) {
    const prefix=`round-${n}/`;
    job.rounds.push({n,startedAt:job.createdAt,build:null,buildCommit:review?job.base.commit:null,checks:review?{path:`${prefix}checks.json`,pass:true,commit:job.base.commit}:null,lenses:{},reviews:{},gate:null});
    if (!review) continue;
    // These are declared upstream fixtures, not real checks or accepted gate evidence.
    addDispatch(job,{round:n,step:"build",lens:null,attempt:1,agent:"sociotechnic-builder",model:"opus",effort:"high",record:`${prefix}build.md`,timeoutMinutes:20},job.createdAt);
    writeTextAtomic(join(jobDir(job.id),`${prefix}build.md`),`STATUS: READY\nCOMMIT: ${job.base.commit}\n`);
    writeJsonAtomic(join(jobDir(job.id),`${prefix}checks.json`),{pass:true,commit:job.base.commit,checks:[]});
    for (const name of ["diff.patch","changed-files.txt","diffstat.txt"]) writeTextAtomic(join(jobDir(job.id),`${prefix}${name}`),`Fixture ${name}\n`);
  }
}
