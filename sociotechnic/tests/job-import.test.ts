import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJob } from "../src/job.ts";
import { createMemoryStore, recordBytes, recordRow } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { parsePlanText } from "../src/plan.ts";
import { createHash } from "node:crypto";
import { releaseContentDigest } from "../src/agent-version-data.ts";
import { inventoryJobs, importJobs } from "../src/db/import-jobs.ts";

const root=mkdtempSync(join(tmpdir(),"sociotechnic-import-"));
process.env.SOCIOTECHNIC_HOME=root;
after(()=>rmSync(root,{recursive:true,force:true}));
beforeEach(()=>{rmSync(join(root,".sociotechnic"),{recursive:true,force:true});});
function job(id="20261024-legacy") { return createJob({id,feature:"Legacy job",repo:"/repo",worktree:"/worktree",branch:`sociotechnic/${id}`,base:{branch:"main",commit:"a".repeat(40)},caps:{rounds:3,dispatchesPerRound:10,retriesPerStep:1},now:"2026-10-24T00:00:00.000Z"}); }
function legacy(id="20261024-legacy") {
 const value=job(id),folder=join(root,".sociotechnic/jobs",id);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,"job.json"),JSON.stringify(value));return {value,folder};
}
test("explicit import preserves binary/large bytes and archives, and retires duplicate job.json",async()=>{
 const store=createMemoryStore(),{value,folder}=legacy();
 const binary=Buffer.from([0,255,1,128]),large="large evidence\n".repeat(180000);
 writeFileSync(join(folder,"preview.png"),binary);writeFileSync(join(folder,"large.patch"),large);
 mkdirSync(join(root,".sociotechnic/console-archives"),{recursive:true});writeFileSync(join(root,".sociotechnic/console-archives",`${value.id}.json`),"{}");
 await store.transaction(async(tx)=>{await tx.upsertJob(value);await tx.upsertRecord(value.id,recordRow("job.json",Buffer.from(JSON.stringify(value))));});
 const manifest=await inventoryJobs(store,true);await importJobs(manifest,store);
 assert.equal((await store.storedJob(value.id))?.archived,true);
 const records=await store.records(value.id);assert(!records.some((r)=>r.path==="job.json"));
 assert.deepEqual(recordBytes(records.find((r)=>r.path==="preview.png")!),binary);
 assert.equal(records.find((r)=>r.path==="large.patch")?.text,large);
 assert.equal((await importJobs(manifest,store)).imported,0);
});
test("unresolved conflicts and changed source bytes cannot be applied",async()=>{
 const store=createMemoryStore(),{value,folder}=legacy();
 await store.transaction((tx)=>tx.upsertJob({...value,feature:"Different database feature"}));
 const unresolved=await inventoryJobs(store);assert.equal(unresolved.entries[0].resolution,"unresolved");
 await assert.rejects(importJobs(unresolved,store),/Resolve all import conflicts/);
 const resolved=await inventoryJobs(store,true);writeFileSync(join(folder,"new.md"),"arrived after inventory");
 await assert.rejects(importJobs(resolved,store),/Source changed/);
 assert.equal((await store.storedJob(value.id))?.feature,"Different database feature");
});
test("database-only jobs and superseded database-only evidence survive local authority selection",async()=>{
 const store=createMemoryStore(),{value,folder}=legacy(),dbOnly=job("20261024-database-only");
 writeFileSync(join(folder,"record.md"),"local authoritative record");
 await store.transaction(async(tx)=>{await tx.upsertJob(value);await tx.upsertJob(dbOnly);await tx.upsertRecord(value.id,recordRow("old.md",Buffer.from("old database evidence")));});
 await importJobs(await inventoryJobs(store,true),store);
 assert(await store.storedJob(dbOnly.id));
 const rows=await store.records(value.id);assert(rows.some((r)=>r.path==="migration/database-only/old.md"));assert(!rows.some((r)=>r.path==="old.md"));
});
test("partial import checkpoints resume without duplicating earlier provenance",async()=>{
 const store=createMemoryStore();legacy("20261024-first");legacy("20261024-second");
 const manifest=await inventoryJobs(store);
 let fail=true;
 const interrupted:Store={...store,transaction:(fn)=>store.transaction((tx)=>fn({...tx,upsertJob:async(value)=>{if(fail&&value.id==="20261024-second")throw Error("simulated interruption");await tx.upsertJob(value);}}))};
 await assert.rejects(importJobs(manifest,interrupted),/simulated interruption/);
 assert(await store.storedJob("20261024-first"));assert.equal(await store.storedJob("20261024-second"),null);
 fail=false;await importJobs(manifest,interrupted);
 assert.equal((await store.events("20261024-first")).length,1);assert.equal((await store.events("20261024-second")).length,1);
});

test("a checkpoint does not conceal changed local sources on resumed import",async()=>{
 const store=createMemoryStore(),first=legacy("20261024-first");legacy("20261024-second");
 writeFileSync(join(first.folder,"evidence.txt"),"original");const manifest=await inventoryJobs(store);
 const interrupted:Store={...store,transaction:(fn)=>store.transaction((tx)=>fn({...tx,upsertJob:async(value)=>{if(value.id==="20261024-second")throw Error("interrupted");await tx.upsertJob(value);}}))};
 await assert.rejects(importJobs(manifest,interrupted),/interrupted/);
 writeFileSync(join(first.folder,"evidence.txt"),"changed after checkpoint");
 await assert.rejects(importJobs(manifest,store),/Source changed/);assert.equal(await store.migration("job-authority-v1"),null);
});
test("concurrent imports serialize and produce one provenance event",async()=>{
 const store=createMemoryStore(),value=job();await store.transaction((tx)=>tx.upsertJob(value));const manifest=await inventoryJobs(store);
 const outcomes=await Promise.all([importJobs(manifest,store),importJobs(manifest,store)]);
 assert.equal(outcomes.reduce((total,out)=>total+out.imported,0),1);assert.equal((await store.events(value.id)).length,1);
});
test("database-only archive markers and conflicting duplicate job documents are preserved explicitly",async()=>{
 const store=createMemoryStore(),value=job();await store.transaction(async(tx)=>{await tx.upsertJob(value);await tx.upsertRecord(value.id,recordRow("job.json",Buffer.from(JSON.stringify({...value,feature:"conflicting duplicate"}))));});
 mkdirSync(join(root,".sociotechnic/console-archives"),{recursive:true});writeFileSync(join(root,".sociotechnic/console-archives",`${value.id}.json`),"{}");
 const manifest=await inventoryJobs(store);assert(manifest.entries[0].conflicts.includes("database/job.json"));
 await importJobs(manifest,store);assert.equal((await store.storedJob(value.id))?.archived,true);
 assert((await store.records(value.id)).some((r)=>r.path==="migration/database-job.json"));
});

test("historical recovery restores pinned evidence without changing the approval digest",async()=>{
 const store=createMemoryStore(),{value,folder}=legacy();
 const text=readFileSync(new URL("../ui/seed/demo-job/plan.json",import.meta.url),"utf8"),parsed=parsePlanText(text,false);
 if(parsed.kind!=="plan")throw Error("Invalid plan fixture");
 value.plan={digest:parsed.digest,tier:parsed.plan.tier,pinnedAt:value.createdAt,researchRound:0};
 writeFileSync(join(folder,"job.json"),JSON.stringify(value));const changed=JSON.stringify({...parsed.plan,title:"Changed after approval"});writeFileSync(join(folder,"plan.json"),changed);
 await assert.rejects(importJobs(await inventoryJobs(store),store),/Pinned plan mismatch/);
 const manifest=await inventoryJobs(store);manifest.entries[0].recoveries=[{path:"plan.json",text,sha256:createHash("sha256").update(text).digest("hex"),source:"git:fixture-original-plan"}];manifest.digest=releaseContentDigest(manifest.entries);
 await importJobs(manifest,store);assert.equal((await store.storedJob(value.id))?.plan?.digest,parsed.digest);
 const records=await store.records(value.id);assert.equal(records.find((r)=>r.path==="plan.json")?.text,text);assert.equal(records.find((r)=>r.path==="migration/unbound/plan.json")?.text,changed);assert.match(records.find((r)=>r.path==="migration/recovery-provenance.json")?.text??"",/git:fixture-original-plan/);
});
