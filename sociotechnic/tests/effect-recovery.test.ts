import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createMemoryStore,setStore } from "../src/db/store.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createJobOperation,mutateJob,effectJob } from "../src/job-store.ts";
import { newJob,merge } from "../src/engine.ts";
import * as git from "../src/git.ts";
async function fixture(t: {after:(fn:()=>void|Promise<void>)=>void}) {
 const root=mkdtempSync(join(tmpdir(),"sociotechnic-effect-")),repo=join(root,"repo");mkdirSync(repo);process.env.SOCIOTECHNIC_HOME=root;
 const store=createMemoryStore();setStore(store);await initializeAgentVersions(store,[],[]);
 t.after(()=>{setStore(undefined);rmSync(root,{recursive:true,force:true});});
 const g=(cwd:string,...args:string[])=>execFileSync("git",["-c","user.name=test","-c","user.email=t@example.invalid","-c","commit.gpgsign=false",...args],{cwd,stdio:"ignore"});
 g(repo,"init","-q","-b","main");g(repo,"config","user.name","test");g(repo,"config","user.email","t@example.invalid");g(repo,"config","commit.gpgsign","false");writeFileSync(join(repo,"readme.md"),"fixture\n");g(repo,"add",".");g(repo,"commit","-qm","fixture");
 const made=await createJobOperation(()=>newJob(repo,"Recover external effects",null));
 writeFileSync(join(made.worktree,"feature.txt"),"feature\n");g(made.worktree,"add",".");g(made.worktree,"commit","-qm","feature");
 await mutateJob(made.job,(job)=>{job.status="ready";});return {store,made,repo,g};
}
test("retry observes and records a local merge completed before database finalization",async(t)=>{
 const {store,made,repo}=await fixture(t);
 await assert.rejects(effectJob(made.job,"merge",(job)=>{merge(job);throw Error("lost final commit");}),/lost final commit/);
 assert.equal((await store.storedJob(made.job))?.status,"ready");const head=git.headCommit(repo);
 const result=await effectJob(made.job,"merge",merge);assert.equal(result.status,"merged-local");assert.equal(result.mergeCommit,head);assert.equal(git.headCommit(repo),head);assert.equal((await store.storedJob(made.job))?.externalOperation,undefined);
});
test("accepted cleanup reconciles an already deleted branch after a lost final commit",async(t)=>{
 const {store,made,repo}=await fixture(t);await effectJob(made.job,"merge",merge);
 await mutateJob(made.job,(job)=>{job.status="accepted";job.human.push({at:new Date().toISOString(),action:"accept",note:"fixture human acceptance"});});
 await assert.rejects(effectJob(made.job,"merge",(job)=>{merge(job);throw Error("lost cleanup commit");}),/lost cleanup commit/);
 assert.equal(git.branchExists(repo,made.branch),false);
 const result=await effectJob(made.job,"merge",merge);assert.equal(result.status,"merged");assert.equal((await store.storedJob(made.job))?.externalOperation,undefined);
});
test("a rejected precondition clears its intent without blocking later job actions",async(t)=>{
 const {store,made,repo,g}=await fixture(t);g(repo,"checkout","-qb","other");
 await assert.rejects(effectJob(made.job,"merge",merge),/expected main/);
 assert.equal((await store.storedJob(made.job))?.externalOperation,undefined);
 await mutateJob(made.job,(job)=>{job.archived=true;});assert.equal((await store.storedJob(made.job))?.archived,true);
});
