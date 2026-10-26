import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { addDispatch, createJob, saveJob } from "../src/job.ts";
import { jobDir } from "../src/paths.ts";
import { readText, writeTextAtomic } from "../src/record-store.ts";
import { ingestDispatch, prepareDispatch, stagedRecord } from "../src/staging.ts";
import type { DispatchOut } from "../src/engine.ts";
import { planDigest } from "../src/plan.ts";
const home=mkdtempSync(join(tmpdir(),"sociotechnic-staging-tests-")),oldHome=process.env.SOCIOTECHNIC_HOME,id="20261024-stage",now="2026-10-24T10:00:00.000Z";
process.env.SOCIOTECHNIC_HOME=home;let store:Store,envelope:DispatchOut,token:string;
let output:string;
const result={outcome:"ok",usage:{input_tokens:10},note:null} as const;
beforeEach(async()=>{
 await releaseDriver(id,process.pid);
 rmSync(join(home,".sociotechnic"),{recursive:true,force:true});store=createMemoryStore();setStore(store);
 const repo=join(home,"repo"),worktree=join(home,"worktree");for(const path of [repo,worktree])rmSync(path,{recursive:true,force:true});mkdirSync(repo);
 const git=(args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","core.fsmonitor=false","-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git(["init","-b","main"]);git(["config","user.name","Fixture"]);git(["config","user.email","fixture@example.invalid"]);writeFileSync(join(repo,"readme.md"),"fixture\n");git(["add","readme.md"]);git(["commit","-m","fixture"]);const head=git(["rev-parse","HEAD"]);git(["worktree","add","-b",`sociotechnic/${id}`,worktree]);
 output=`STATUS: READY\nCOMMIT: ${head}\n`;
 const plan=JSON.parse(readFileSync(new URL("../schemas/plan.schema.json",import.meta.url),"utf8")).examples[0];
 await createJobOperation(()=>{const job=createJob({id,feature:"stage safely",repo,worktree,branch:`sociotechnic/${id}`,base:{branch:"main",commit:head},caps:{rounds:3,dispatchesPerRound:10,retriesPerStep:1},now});job.status="building";job.plan={digest:planDigest(plan),tier:"EASY",pinnedAt:now,researchRound:0};saveJob(job);writeTextAtomic(join(jobDir(id),"plan.json"),JSON.stringify(plan));writeTextAtomic(join(jobDir(id),"plan.md"),"committed input\n");const d=addDispatch(job,{round:1,step:"build",lens:null,attempt:1,agent:"sociotechnic-builder",model:"opus",effort:"high",record:"round-1/build.md",timeoutMinutes:30},now);envelope={id:d.id,agent:d.agent,model:d.model,effort:d.effort,deadlineAt:d.deadlineAt,record:d.record,prompt:`Read ${join(jobDir(id),"plan.md")} and write ${join(jobDir(id),d.record)}`};d.execution={envelope,launch:"pending"};});
 token=await acquireDriver(id,{pid:process.pid,startedAt:now,mode:"run",owner:"ui"});
});
after(async()=>{await releaseDriver(id,process.pid);setStore(undefined);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;rmSync(home,{recursive:true,force:true});});

test("dispatch stages committed inputs, scopes prompt paths and atomically ingests completion",async()=>{
 const stage=await prepareDispatch(id,envelope,token);assert.equal(readFileSync(join(stage.inputs,"plan.md"),"utf8"),"committed input\n");assert.match(stage.entry.prompt,/inputs\/plan\.md/);assert.ok(stage.entry.prompt.includes(stagedRecord(stage)));assert.equal((await store.storedJob(id))?.dispatches[0].execution?.launch,"claimed");
 writeFileSync(stagedRecord(stage),output);const finished=await ingestDispatch(id,stage,result);assert.equal(finished.parsed?.effective,"READY");const saved=await store.storedJob(id);assert.equal(saved?.dispatches[0].execution?.launch,"finished");assert.equal(await readJob(id,()=>readText(join(jobDir(id),envelope.record))),output);assert.equal(existsSync(stage.root),false);assert.equal(existsSync(jobDir(id)),false);
});

test("changed or removed staged inputs cannot alter committed evidence",async()=>{
 const stage=await prepareDispatch(id,envelope,token);writeFileSync(stagedRecord(stage),output);writeFileSync(join(stage.inputs,"plan.md"),"poison");await assert.rejects(ingestDispatch(id,stage,result),/input changed/i);assert.equal((await store.storedJob(id))?.dispatches[0].finishedAt,null);assert.equal(await readJob(id,()=>readText(join(jobDir(id),"plan.md"))),"committed input\n");
});

test("undeclared and symlinked outputs are rejected without completing the dispatch",async()=>{
 const stage=await prepareDispatch(id,envelope,token);writeFileSync(stagedRecord(stage),output);writeFileSync(join(stage.outputs,"foreign.txt"),"not declared");await assert.rejects(ingestDispatch(id,stage,result),/Undeclared output/);rmSync(join(stage.outputs,"foreign.txt"));symlinkSync(join(stage.inputs,"plan.md"),join(stage.outputs,"foreign.txt"));await assert.rejects(ingestDispatch(id,stage,result),/Symlinked/);assert.equal((await store.storedJob(id))?.dispatches[0].finishedAt,null);
});

test("an obsolete owner cannot ingest or relaunch an already claimed dispatch",async()=>{
 const stage=await prepareDispatch(id,envelope,token);writeFileSync(stagedRecord(stage),output);await store.setDriver(id,{token:"new-owner"});await assert.rejects(ingestDispatch(id,stage,result),/Stale driver completion/);await assert.rejects(prepareDispatch(id,envelope,token),/Previous dispatch staging/);assert.equal((await store.storedJob(id))?.dispatches[0].finishedAt,null);
});

test("replayed exact completion is idempotent and changed replay is rejected",async()=>{
 const stage=await prepareDispatch(id,envelope,token);writeFileSync(stagedRecord(stage),output);const backup=join(home,"replay-backup");rmSync(backup,{recursive:true,force:true});cpSync(stage.root,backup,{recursive:true});await ingestDispatch(id,stage,result);const events=await store.events(id);mkdirSync(dirname(stage.root),{recursive:true});cpSync(backup,stage.root,{recursive:true});const repeated=await ingestDispatch(id,stage,result);assert.equal(repeated.parsed?.effective,"READY");assert.deepEqual(await store.events(id),events);cpSync(backup,stage.root,{recursive:true});writeFileSync(stagedRecord(stage),output+"different\n");await assert.rejects(ingestDispatch(id,stage,result),/different output/);
});

test("quarantined migration evidence never enters routine agent inputs",async()=>{
 await mutateJob(id,()=>writeTextAtomic(join(jobDir(id),"migration/unbound/plan.json"),"obsolete plan"));
 const stage=await prepareDispatch(id,envelope,token);
 assert.equal(existsSync(join(stage.inputs,"migration")),false);
 assert(!Object.keys(stage.manifest).some((path)=>path.startsWith("migration/")));
 assert.equal(readFileSync(join(stage.inputs,"plan.md"),"utf8"),"committed input\n");
});
