import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectClient, createPgStore, recordBytes, recordRow, setStore } from "../src/db/store.ts";
import { checkCatalogBundles, exportCatalogBundle, readCatalogBundles } from "../src/db/catalog-migrations.ts";
import { releaseContentDigest } from "../src/agent-version-data.ts";
import { initializeAgentVersions, latestAgentVersion, publishAgentVersion, readAgentVersion, restoreAgentVersions } from "../src/agent-versions.ts";
import { roleOf } from "../src/roles.ts";
type Json=Record<string,unknown>;
const server=process.env.SOCIOTECHNIC_TEST_DATABASE_URL?.trim()??"",name=`sociotechnic_test_${process.pid}`,root=mkdtempSync(join(tmpdir(),"sociotechnic-dbpg-")),home=join(root,"home"),bin=join(dirname(fileURLToPath(import.meta.url)),"../bin/sociotechnic"),skip=server===""?"SOCIOTECHNIC_TEST_DATABASE_URL is not set":false;
mkdirSync(home);const url=server===""?"":withDatabase(server,name);
function withDatabase(connection:string,database:string){const parsed=new URL(connection);parsed.pathname=`/${database}`;return parsed.toString();}
after(async()=>{setStore(undefined);rmSync(root,{recursive:true,force:true});if(!server)return;const admin=await connectClient(withDatabase(server,"postgres"));try{await admin.query(`drop database if exists "${name}" with (force)`);}finally{await admin.end();}});
function cli(...args:string[]):Json{const result=spawnSync(bin,args,{env:{...process.env,SOCIOTECHNIC_HOME:home,SOCIOTECHNIC_DATABASE_URL:url},encoding:"utf8"});assert.equal(result.stderr,"",`stderr from ${args.join(" ")}: ${result.stderr}`);const out=JSON.parse(result.stdout) as Json;assert.equal(result.status,0,`CLI ${args.join(" ")} failed: ${result.stdout}`);assert.equal(out.warnings,undefined);return out;}
function repo(){const folder=join(root,"target");mkdirSync(folder);const git=(...args:string[])=>execFileSync("git",["-c","user.name=test","-c","user.email=test@example.invalid","-c","commit.gpgsign=false","-c","core.hooksPath=/dev/null",...args],{cwd:folder,stdio:"ignore"});git("init","-q","-b","main");writeFileSync(join(folder,".sociotechnic.json"),JSON.stringify({checks:[{name:"ok",run:'node -e "process.exit(0)"',timeoutSeconds:60}]}));git("add","-A");git("commit","-q","-m","init");return folder;}

test("pg: CLI creates database-only jobs, ignores poisoned local state and restores Git worktree only",{skip},async()=>{
 const initialized=cli("db","init");assert.equal(initialized.database,name);assert.equal(initialized.created,true);assert.equal(cli("db","init").created,false);
 const target=repo(),made=cli("new",target,"Add the PostgreSQL feature"),id=String(made.job),worktree=String(made.worktree),folder=join(home,".sociotechnic/jobs",id);
 assert.equal(existsSync(folder),false);const status=cli("db","status");assert.equal(status.reachable,true);assert.equal(status.jobs,1);assert.equal(status.records,0);
 mkdirSync(folder,{recursive:true});writeFileSync(join(folder,"job.json"),"broken local truth");
 const jobs=cli("jobs","--project",basename(target)) as {source:string;jobs:Json[]};assert.equal(jobs.source,"db");assert.deepEqual(jobs.jobs.map((job)=>[job.id,job.status,job.worktreePresent]),[[id,"new",true]]);assert.ok(!("present" in jobs.jobs[0]));assert.equal(cli("status",id).status,"new");
 const projects=cli("projects") as {projects:Json[]};assert.equal(projects.projects[0].jobs,1);
 execFileSync("git",["worktree","remove","--force",worktree],{cwd:target,stdio:"ignore"});assert.equal((cli("status") as {jobs:Json[]}).jobs[0].worktreePresent,false);
 assert.deepEqual(cli("restore",id),{job:id,worktree:"restored"});assert.ok(existsSync(worktree));assert.deepEqual(cli("restore",id),{job:id,worktree:"present"});
 rmSync(folder,{recursive:true});rmSync(join(home,".sociotechnic/staging"),{recursive:true,force:true});const resumed=cli("resume",id);assert.equal(resumed.action,"dispatch");assert.equal(resumed.status,"planning");assert.equal(existsSync(folder),false);
 const store=createPgStore(url);try{assert.deepEqual((await store.events(id)).map((event)=>event.kind),["sync","status","dispatch-started"]);const dispatch=(await store.storedJob(id))?.dispatches[0];assert.ok(dispatch?.execution?.envelope.prompt);assert.equal(dispatch.execution.launch,"pending");assert.equal((await store.records(id)).some((row)=>row.path==="job.json"),false);}finally{await store.close();}
});

test("pg: all committed catalog versions survive initialization, publication concurrency and cache loss",{skip},async()=>{
 const store=createPgStore(url),planner=roleOf("sociotechnic-planner"),oldHome=process.env.SOCIOTECHNIC_HOME;process.env.SOCIOTECHNIC_HOME=home;setStore(store);
 try{
  const rows=readCatalogBundles().flatMap((bundle)=>bundle.releases),identities=new Set(rows.map((row)=>`${row.agent}@${row.version}`));assert.equal((await store.agentVersions()).length,identities.size);assert.equal((await checkCatalogBundles(store)).ok,true);
  for(const bundled of rows){const stored=(await store.agentVersions(bundled.agent)).find((row)=>row.version===bundled.version);assert.ok(stored);assert.equal(stored.contentDigest,bundled.contentDigest);assert.deepEqual(stored.release,bundled.release);}
  const baseline=await readAgentVersion(planner,"1.0.0"),same={agent:planner.name,version:baseline.version,contentDigest:releaseContentDigest(baseline),release:baseline};await store.transaction((tx)=>tx.insertAgentVersion(same));await assert.rejects(store.transaction((tx)=>tx.insertAgentVersion({...same,contentDigest:"0".repeat(64)})),/Conflicting immutable release/);
  await assert.rejects(store.exec("update agent_versions set release=release where agent='sociotechnic-planner'"),/immutable/);await assert.rejects(store.exec("delete from agent_versions where agent='sociotechnic-planner'"),/immutable/);
  const latest=await latestAgentVersion(planner),parts=latest.split(".").map(Number),next=`${parts[0]}.${parts[1]}.${parts[2]+1}`,current=await readAgentVersion(planner,latest),body={...current.role,version:next,expectedLatest:latest,label:"PostgreSQL concurrency",model:"sonnet"};const results=await Promise.allSettled([publishAgentVersion(planner,body),publishAgentVersion(planner,body)]);assert.equal(results.filter((r)=>r.status==="fulfilled").length,1);assert.equal((await readAgentVersion(planner,next)).role.model,"sonnet");assert.deepEqual((await readAgentVersion(planner,"1.0.0")),baseline);
  const job=(await store.listJobs({}))[0].job;await assert.rejects(store.transaction((tx)=>tx.linkAgentVersions(job.id,{...job.agentVersions,[planner.name]:next})),/changed pinned/);await assert.rejects(store.exec("insert into job_agent_versions(job_id,slot,agent,version) select id,'invalid','sociotechnic-planner','99.0.0' from jobs limit 1"),/foreign key/);
  rmSync(join(home,".sociotechnic/agent-versions"),{recursive:true,force:true});await restoreAgentVersions(store,job);await initializeAgentVersions(store);assert.equal((await readAgentVersion(planner,next)).role.model,"sonnet");assert.equal((await store.agentVersions()).length,identities.size+1);assert.equal((await exportCatalogBundle(store)).releases.length,identities.size+1);
 }finally{setStore(undefined);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;await store.close();}
});

test("pg: binary and large record bytes survive connection restarts and locks exclude a second owner",{skip},async()=>{
 const one=createPgStore(url),two=createPgStore(url);try{const job=(await one.listJobs({}))[0].job,binary=Buffer.from([0,137,255,10,0]),large=Buffer.alloc(2*1024*1024+37,120);await one.transaction(async(tx)=>{await tx.upsertRecord(job.id,recordRow("design/atelier/round-1/binary.png",binary));await tx.upsertRecord(job.id,recordRow("round-1/large.patch",large));});await one.close();const records=await two.records(job.id),image=records.find((row)=>row.path.endsWith("binary.png")),patch=records.find((row)=>row.path.endsWith("large.patch"));assert.ok(image);assert.ok(patch);assert.deepEqual(recordBytes(image),binary);assert.deepEqual(recordBytes(patch),large);
 const lease=await two.lock(`test:${job.id}`);try{await assert.rejects(one.lock(`test:${job.id}`),/Another process owns/);}finally{await lease.release();}const next=await one.lock(`test:${job.id}`);await next.release();
 }finally{await one.close();await two.close();}
});
