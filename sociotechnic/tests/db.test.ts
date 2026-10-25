import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { listJobs, listProjects, loadJobHistory } from "../src/db/listing.ts";
import { createMemoryStore, DbUnreachable, redactUrl, setStore } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { deriveEvents } from "../src/db/events.ts";
import { createJob } from "../src/job.ts";
import { jobDir } from "../src/paths.ts";
const home=mkdtempSync(join(tmpdir(),"sociotechnic-db-authority-")), oldHome=process.env.SOCIOTECHNIC_HOME, T0="2026-10-24T10:00:00.000Z";
process.env.SOCIOTECHNIC_HOME=home;
beforeEach(()=>{setStore(undefined);rmSync(join(home,".sociotechnic"),{recursive:true,force:true});});
after(()=>{setStore(undefined);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;rmSync(home,{recursive:true,force:true});});
function fixture(id:string,repo="/repos/alpha",status:"new"|"stopped"="new") {const job=createJob({id,feature:`Feature ${id}`,repo,worktree:join(home,"worktrees",id),branch:`sociotechnic/${id}`,base:{branch:"main",commit:"a".repeat(40)},caps:{rounds:3,dispatchesPerRound:10,retriesPerStep:1},now:T0});job.status=status;return job;}
async function put(store:Store,job:ReturnType<typeof fixture>){await store.transaction((tx)=>tx.upsertJob(job));}
test("listings use database jobs and ignore conflicting or malformed local files",async()=>{
 const store=createMemoryStore();setStore(store);const one=fixture("20261024-one"),two=fixture("20261024-two","/repos/beta","stopped");await put(store,one);await put(store,two);
 mkdirSync(jobDir(one.id),{recursive:true});writeFileSync(join(jobDir(one.id),"job.json"),"{poison");const local=fixture("20261024-local");mkdirSync(jobDir(local.id),{recursive:true});writeFileSync(join(jobDir(local.id),"job.json"),JSON.stringify(local));
 const list=await listJobs();assert.equal(list.source,"db");assert.deepEqual(list.jobs.map((j)=>j.id),[two.id,one.id]);assert.ok(list.jobs.every((j)=>!("present" in j)&&j.worktreePresent===false));
 assert.deepEqual((await listJobs({project:"alpha"})).jobs.map((j)=>j.id),[one.id]);assert.deepEqual((await listJobs({project:"/repos/beta",status:"stopped",limit:1})).jobs.map((j)=>j.id),[two.id]);
 const history=await loadJobHistory();assert.deepEqual(history.jobs.map((j)=>j.id),[two.id,one.id]);assert.deepEqual(history.warnings,[]);assert.equal((await listProjects()).projects.reduce((n,p)=>n+p.jobs,0),2);
});
test("disabled and unreachable databases fail rather than falling back to local history",async()=>{
 const local=fixture("20261024-local");mkdirSync(jobDir(local.id),{recursive:true});writeFileSync(join(jobDir(local.id),"job.json"),JSON.stringify(local));setStore(null);
 await assert.rejects(listJobs(),/require PostgreSQL/);await assert.rejects(listProjects(),/require PostgreSQL/);await assert.rejects(loadJobHistory(),/require PostgreSQL/);
 const store=createMemoryStore();setStore({...store,listJobs:async()=>{throw new DbUnreachable("database unavailable");},listProjects:async()=>{throw new DbUnreachable("database unavailable");}});
 await assert.rejects(listJobs(),/database unavailable/);await assert.rejects(listProjects(),/database unavailable/);await assert.rejects(loadJobHistory(),/database unavailable/);
});
test("events retain status, human and override provenance",()=>{
 const previous=fixture("20261024-events"),next=structuredClone(previous);next.status="stopped";next.updatedAt="2026-10-24T10:01:00.000Z";next.statusReason="human stop";next.human.push({at:next.updatedAt,action:"stop",note:"pause work"});next.overrides.push({at:next.updatedAt,bound:"rounds",note:"one more"});
 assert.deepEqual(deriveEvents(previous,next,T0).map((e)=>e.kind),["status","human","override"]);assert.deepEqual(deriveEvents(previous,previous,T0),[]);assert.deepEqual(deriveEvents(null,previous,T0).map((e)=>e.kind),["sync"]);
});
test("redactUrl hides PostgreSQL passwords",()=>{assert.equal(redactUrl("postgres://sid:s3cret@localhost:5433/sociotechnic"),"postgres://sid:***@localhost:5433/sociotechnic");});
