import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync,spawnSync } from "node:child_process";
import { createMemoryStore,createPgStore,setStore } from "../src/db/store.ts";
import type { Store } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createJobOperation,mutateJob } from "../src/job-store.ts";
import * as git from "../src/git.ts";
import { newJob } from "../src/engine.ts";
import { restoreJob } from "../src/db/restore.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import { testDatabase } from "./pg-fixture.ts";
const database=await testDatabase("restoreguards");
async function fixture(store:Store,t:{after:(fn:()=>void|Promise<void>)=>void}){
 const root=mkdtempSync(join(tmpdir(),"sociotechnic-restore-guards-")),repo=join(root,"repo");mkdirSync(repo);process.env.SOCIOTECHNIC_HOME=root;setStore(store);await initializeAgentVersions(store,[],[]);
 t.after(async()=>{setStore(undefined);await store.close();rmSync(root,{recursive:true,force:true});});
 const g=(...args:string[])=>execFileSync("git",["-c","user.name=test","-c","user.email=t@example.invalid","-c","commit.gpgsign=false",...args],{cwd:repo,stdio:"ignore"});
 g("init","-q","-b","main");writeFileSync(join(repo,"README.md"),"fixture\n");g("add",".");g("commit","-qm","fixture");
 const made=await createJobOperation(()=>newJob(repo,"Guard recovery",null));g("worktree","remove","--force",made.worktree);return {made,root};
}
test("a refused human-gate run and a foreign-owned restore cannot recreate a worktree",async(t)=>{
 const store=createMemoryStore(),{made}=await fixture(store,t);await mutateJob(made.job,(job)=>{job.status="ready";});
 const registry=createDriverRegistry({emit:()=>undefined,runner:()=>({name:"fake",run:async()=>{throw Error("No agent should launch");}})});
 await assert.rejects(registry.run(made.job,"run",[]),/human gate|finished job/);assert.equal(existsSync(made.worktree),false);
 await store.setDriver(made.job,{pid:123,host:"foreign",token:"foreign"});await assert.rejects(restoreJob(made.job),/Stop.*driver|reconcile.*driver/);assert.equal(existsSync(made.worktree),false);assert.equal((await store.storedJob(made.job))?.externalOperation,undefined);
});
test("PostgreSQL authority and CLI status guards run before any recovery effect",{skip:!database},async(t)=>{
 if(!database)return;const store=createPgStore(database),{made,root}=await fixture(store,t);
 await mutateJob(made.job,(job)=>{job.status="ready";});
 const result=spawnSync(process.execPath,[new URL("../src/cli.ts",import.meta.url).pathname,"run",made.job,"--no-open"],{env:{...process.env,SOCIOTECHNIC_HOME:root,SOCIOTECHNIC_DATABASE_URL:database},encoding:"utf8"});
 assert.equal(JSON.parse(result.stdout).code,"illegal-transition");assert.equal(existsSync(made.worktree),false);
 await store.exec("delete from state_migrations where name='job-authority-v1'");
 await assert.rejects(restoreJob(made.job),/import-jobs/);assert.equal(existsSync(made.worktree),false);
});

test("an interrupted creation intent restores its pinned branch and worktree once",async(t)=>{
 const store=createMemoryStore(),{made}=await fixture(store,t);
 git.git((await store.storedJob(made.job))!.repo,["branch","-D",made.branch]);
 await mutateJob(made.job,(job)=>{job.creation={state:"pending"};});
 assert.deepEqual(await restoreJob(made.job),{job:made.job,worktree:"restored"});
 assert.equal(existsSync(made.worktree),true);assert.equal((await store.storedJob(made.job))?.creation?.state,"complete");
 assert.deepEqual(await restoreJob(made.job),{job:made.job,worktree:"present"});
});
