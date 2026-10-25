import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createMemoryStore, recordBytes, setStore } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { createJob, saveJob } from "../src/job.ts";
import { createJobOperation, mutateJob, readJob } from "../src/job-store.ts";
import { jobDir } from "../src/paths.ts";
import { readBytes, readText, session, writeBytes, writeJsonAtomic, writeTextAtomic } from "../src/record-store.ts";
const home=mkdtempSync(join(tmpdir(),"sociotechnic-job-store-")),oldHome=process.env.SOCIOTECHNIC_HOME,id="20261024-authority",T0="2026-10-24T10:00:00.000Z";
process.env.SOCIOTECHNIC_HOME=home;let store:Store;
beforeEach(async()=>{rmSync(join(home,".sociotechnic"),{recursive:true,force:true});store=createMemoryStore();setStore(store);await createJobOperation(()=>{saveJob(createJob({id,feature:"Database is authoritative",repo:"/repos/demo",worktree:join(home,"worktree"),branch:`sociotechnic/${id}`,base:{branch:"main",commit:"a".repeat(40)},caps:{rounds:3,dispatchesPerRound:10,retriesPerStep:1},now:T0}));writeTextAtomic(join(jobDir(id),"plan.md"),"original evidence\n");},store);});
after(()=>{setStore(undefined);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;rmSync(home,{recursive:true,force:true});});
test("creation commits job and evidence without local job.json or duplicate stored document",async()=>{
 assert.equal((await store.storedJob(id))?.feature,"Database is authoritative");assert.equal(existsSync(jobDir(id)),false);const records=await store.records(id);assert.deepEqual(records.map((r)=>r.path),["plan.md"]);assert.equal(records[0].text,"original evidence\n");
 await mutateJob(id,()=>writeJsonAtomic(join(jobDir(id),"job.json"),{feature:"second truth"}));assert.ok(!(await store.records(id)).some((r)=>r.path==="job.json"));assert.equal((await store.storedJob(id))?.feature,"Database is authoritative");
});
test("job, record and event changes roll back together when commit fails",async()=>{
 const before=await store.storedJob(id),records=await store.records(id),events=await store.events(id);const failing:Store={...store,transaction:(fn)=>store.transaction((tx)=>fn({...tx,insertEvents:async()=>{throw new Error("injected commit failure");}}))};
 await assert.rejects(mutateJob(id,(job)=>{job.status="stopped";writeTextAtomic(join(jobDir(id),"plan.md"),"uncommitted evidence");},failing),/injected commit failure/);assert.deepEqual(await store.storedJob(id),before);assert.deepEqual(await store.records(id),records);assert.deepEqual(await store.events(id),events);
});
test("local poison cannot affect committed reads or later writes",async()=>{
 mkdirSync(jobDir(id),{recursive:true});writeFileSync(join(jobDir(id),"job.json"),"broken JSON");writeFileSync(join(jobDir(id),"plan.md"),"poison");assert.equal(await readJob(id,()=>readText(join(jobDir(id),"plan.md"))),"original evidence\n");await mutateJob(id,(job)=>{job.feature="new database feature";});assert.equal(readFileSync(join(jobDir(id),"job.json"),"utf8"),"broken JSON");assert.equal((await store.storedJob(id))?.feature,"new database feature");
});
test("binary and records over the old mirror limit survive exact round trips and staging loss",async()=>{
 const binary=Buffer.from([0,255,216,137,0,10]),large=Buffer.alloc(2*1024*1024+19,120);await mutateJob(id,()=>{writeBytes(join(jobDir(id),"design/atelier/round-1/preview.png"),binary);writeBytes(join(jobDir(id),"round-1/diff.patch"),large);});const stored=await store.records(id),preview=stored.find((r)=>r.path.endsWith("preview.png"));assert.ok(preview);assert.deepEqual(recordBytes(preview),binary);assert.deepEqual(await readJob(id,()=>readBytes(join(jobDir(id),"round-1/diff.patch"))),large);rmSync(join(home,".sociotechnic/staging"),{recursive:true,force:true});assert.deepEqual(await readJob(id,()=>readBytes(join(jobDir(id),"design/atelier/round-1/preview.png"))),binary);
});
test("stale concurrent job edits cannot overwrite another writer",async()=>{
 let finish!:()=>void,signal!:()=>void;const started=new Promise<void>((resolve)=>{signal=resolve;}),barrier=new Promise<void>((resolve)=>{finish=resolve;});const first=mutateJob(id,async(job)=>{job.feature="stale";signal();await barrier;});await started;await store.transaction(async(tx)=>{const job=await tx.storedJob(id);assert.ok(job);job.feature="other writer";await tx.upsertJob(job);});finish();await assert.rejects(first,/changed during this operation/);assert.equal((await store.storedJob(id))?.feature,"other writer");
});
test("missing jobs and database-off operations fail without creating files",async()=>{
 await assert.rejects(readJob("20261024-missing",()=>null),/Unknown job/);setStore(null);await assert.rejects(async()=>readJob(id,()=>null),/require PostgreSQL/);await assert.rejects(async()=>mutateJob(id,()=>null),/require PostgreSQL/);assert.equal(existsSync(jobDir(id)),false);
});
test("records cannot escape this job",async()=>{await assert.rejects(mutateJob(id,()=>writeTextAtomic(join(jobDir(id),"../other/plan.md"),"foreign")),/escapes this job/);assert.equal(await readJob(id,()=>session().records.has("../other/plan.md")),false);});
test("record-only concurrent edits invalidate a stale operation snapshot",async()=>{
 const started=deferred(),barrier=deferred();const first=mutateJob(id,async()=>{writeTextAtomic(join(jobDir(id),"plan.md"),"stale evidence");started.resolve();await barrier.promise;});await started.promise;
 await store.transaction((tx)=>tx.upsertRecord(id,{path:"plan.md",text:"other writer evidence",bytes:21,mtime:T0}));barrier.resolve();await assert.rejects(first,/changed during this operation/);assert.equal((await store.records(id)).find((row)=>row.path==="plan.md")?.text,"other writer evidence");
});
test("ownership connection loss rejects the operation without committing state or records",async()=>{
 const abort=new AbortController(),before=await store.storedJob(id),records=await store.records(id),withLostLease:Store={...store,lock:async()=>({token:"lost-owner",signal:abort.signal,verify:async()=>undefined,release:async()=>undefined})};
 await assert.rejects(mutateJob(id,(job)=>{job.status="stopped";writeTextAtomic(join(jobDir(id),"plan.md"),"uncommitted after lease loss");abort.abort();},withLostLease),/ownership was lost/);assert.deepEqual(await store.storedJob(id),before);assert.deepEqual(await store.records(id),records);
});

function deferred() { let resolve: ()=>void = ()=>undefined; const promise = new Promise<void>((done)=> {resolve=done;}); return {promise,resolve}; }
