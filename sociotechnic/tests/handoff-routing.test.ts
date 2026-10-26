import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { finish, newJob, step } from "../src/engine.ts";
import { handoffInput, preflightDriverStep, rejectHandoffs } from "../src/handoff-routing.ts";
import { preflightHandoff } from "../src/handoff.ts";
import { createJobOperation, effectJob, mutateJob, readJob } from "../src/job-store.ts";
import { restoreWorktree } from "../src/db/restore.ts";
import { stop } from "../src/job.ts";
import { jobDir } from "../src/paths.ts";
import { readJson, session, writeJsonAtomic } from "../src/record-store.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import type { DriverState } from "../ui/driver.ts";
import type { Runner } from "../ui/runner.ts";

const homes:string[]=[], oldHome=process.env.SOCIOTECHNIC_HOME;
afterEach(async()=>{setStore(null);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;for(const home of homes.splice(0))rmSync(home,{recursive:true,force:true});});
const git=(cwd:string,...args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","core.fsmonitor=false","-C",cwd,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();

async function fixture() {
  const home=mkdtempSync(join(tmpdir(),"sociotechnic-handoff-route-"));homes.push(home);process.env.SOCIOTECHNIC_HOME=join(home,"control");mkdirSync(process.env.SOCIOTECHNIC_HOME);
  const store=createMemoryStore();setStore(store);await initializeAgentVersions(store,[],[]);
  const repo=join(home,"repo");mkdirSync(repo);git(repo,"init","-b","main");git(repo,"config","user.name","Fixture");git(repo,"config","user.email","fixture@example.invalid");writeFileSync(join(repo,"readme.md"),"tbd\n");git(repo,"add","readme.md");git(repo,"commit","-m","fixture");
  const created=await createJobOperation(()=>newJob(repo,"Write a scoped review report",null));await effectJob(created.job,"restore",job=>{restoreWorktree(job);if(job.creation)job.creation.state="complete";});return {home,store,id:created.job};
}

test("whole-wave preflight persists owned errors and zero launches, including missing pinned data",async()=>{
  const f=await fixture();const first=await mutateJob(f.id,job=>step(job));assert.equal(first.action,"dispatch");if(first.action!=="dispatch")return;
  await mutateJob(f.id,job=>{writeJsonAtomic(join(jobDir(f.id),"plan.json"),{status:"needs-research",questions:["First evidence?","Second evidence?"]});finish(job,first.dispatches[0].id,"ok",null,null);});
  const wave=await mutateJob(f.id,job=>step(job));assert.equal(wave.action,"dispatch");if(wave.action!=="dispatch")return;
  assert.equal(wave.dispatches.length,2);
  const result=await mutateJob(f.id,job=>{job.research.questions.pop();return preflightDriverStep(job,wave);});
  assert.equal(result.action,"human");if(result.action!=="human")return;
  assert.ok(result.handoff?.issues.some(issue=>issue.field==="task.context"&&issue.code==="missing-research-question"));
  const saved=await f.store.storedJob(f.id);assert.equal(saved?.status,"needs-human");
  for(const dispatch of saved!.dispatches.filter(d=>d.step==="research")){assert.equal(dispatch.finishedAt,null);assert.equal(dispatch.execution?.launch,"pending");}
  await readJob(f.id,job=>{const report=readJson(join(jobDir(f.id),result.handoff!.record)) as {dispatches:{envelope:{id:string}}[]};assert.equal(report.dispatches[0].envelope.id,wave.dispatches[1].id);const input=handoffInput(job,{...wave.dispatches[0],configuration:undefined},session().records);assert.ok(preflightHandoff(input).some(issue=>issue.code==="missing-pinned-profile"));});
});

test("real driver preserves approval then delivers builder questions and archived dispatch context to human control",async()=>{
  const f=await fixture(),calls:string[]=[];const plan=JSON.parse(readFileSync(new URL("../schemas/plan.schema.json",import.meta.url),"utf8")).examples[0];plan.stages[0].files=["readme.md"];plan.touches=["readme.md"];
  const runner:Runner={name:"fake",async run(_entry,role,ctx){calls.push(role.record);mkdirSync(dirname(ctx.recordPath),{recursive:true});writeFileSync(ctx.recordPath,role.record==="plan"?JSON.stringify(plan):`STATUS: BLOCKED\nCOMMIT: ${git(ctx.worktree,"rev-parse","HEAD")}\n\n## Summary\nAwait a real decision.\n\n## Blocker\nWhich audience should the report address?\n`);return {outcome:"ok",usage:null,note:null};}};
  const driver=createDriverRegistry({runner:()=>runner,emit:()=>{}});
  await driver.run(f.id,"run",["planned"]);await driver.settled(f.id);assert.deepEqual(calls,["plan"]);assert.equal((await f.store.storedJob(f.id))?.status,"planned");
  await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.deepEqual(calls,["plan","build"]);
  const saved=(await f.store.storedJob(f.id))!;assert.equal(saved.status,"needs-human");assert.equal(saved.dispatches.at(-1)?.parsed?.value,"BLOCKED");
  const last=driver.state(f.id).lastStep;assert.equal(last?.action,"human");if(last?.action!=="human")return;
  assert.ok(last.handoff?.issues.some(issue=>issue.owner==="human"));
  await readJob(f.id,job=>{const report=readJson(join(jobDir(f.id),last.handoff!.record)) as {blocker:{text:string};dispatch:{envelope:{id:string}}};assert.match(report.blocker.text,/Which audience/);assert.equal(report.dispatch.envelope.id,saved.dispatches.at(-1)?.id);const archived=readJson(join(jobDir(f.id),saved.dispatches.at(-1)!.execution!.handoffRecord!)) as {envelope:{prompt:string};handoff:{identity:{job:string}}};assert.equal(archived.handoff.identity.job,job.id);assert.match(archived.envelope.prompt,/\/inputs\/contracts\/handoff.json/);});
});

test("a workspace race is caught after staging before provider launch and human stop is never reversed",async()=>{
  const f=await fixture(),calls:string[]=[];let changed=false;const plan=JSON.parse(readFileSync(new URL("../schemas/plan.schema.json",import.meta.url),"utf8")).examples[0];
  const runner:Runner={name:"fake",async run(_entry,role,ctx){calls.push(role.record);assert.equal(role.record,"plan");mkdirSync(dirname(ctx.recordPath),{recursive:true});writeFileSync(ctx.recordPath,JSON.stringify(plan));return {outcome:"ok",usage:null,note:null};}};
  const driver=createDriverRegistry({runner:()=>runner,emit:event=>{const state=event.state as DriverState|undefined;if(!changed&&event.event==="step"&&state?.lastStep?.action==="dispatch"&&state.lastStep.dispatches.some(d=>d.agent==="sociotechnic-builder-lite")){changed=true;const job=state.lastStep.job;const path=join(process.env.SOCIOTECHNIC_HOME!,".sociotechnic","worktrees",job);git(path,"checkout","-b","unexpected-fixture-branch");}}});
  await driver.run(f.id,"run",["planned"]);await driver.settled(f.id);await driver.run(f.id,"run",[]);await driver.settled(f.id);
  assert.deepEqual(calls,["plan"]);const saved=(await f.store.storedJob(f.id))!;assert.equal(saved.status,"needs-human");assert.ok(saved.handoffEscalation?.issues.some(issue=>issue.field==="workspace.branch"));assert.equal(saved.dispatches.at(-1)?.execution?.launch,"pending");
  await mutateJob(f.id,job=>{stop(job,new Date().toISOString());const entry=job.dispatches.at(-1)!.execution!.envelope;const r=rejectHandoffs(job,[{entry,issues:[{field:"workspace.branch",code:"test-race",message:"Wrong branch",owner:"driver"}]}]);assert.equal(r.action,"done");assert.equal(job.status,"stopped");});
});
