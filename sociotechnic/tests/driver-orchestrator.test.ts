import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { newJob } from "../src/engine.ts";
import { createJobOperation, effectJob, mutateJob, readJob } from "../src/job-store.ts";
import { restoreWorktree } from "../src/db/restore.ts";
import { stop } from "../src/job.ts";
import { orchestratorRecord } from "../src/orchestrator.ts";
import type { OrchestratorRequest } from "../src/orchestrator.ts";
import { session } from "../src/record-store.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import type { Runner } from "../ui/runner.ts";
import { binding } from "./helpers/orchestrator-binding.ts";

const homes:string[]=[],oldHome=process.env.SOCIOTECHNIC_HOME,oldLimit=process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES;
afterEach(()=>{setStore(null);if(oldLimit===undefined)delete process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES;else process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES=oldLimit;if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;for(const home of homes.splice(0))rmSync(home,{recursive:true,force:true});});
const git=(cwd:string,...args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","core.fsmonitor=false","-C",cwd,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
async function fixture(){const home=mkdtempSync(join(tmpdir(),"sociotechnic-supervision-"));homes.push(home);process.env.SOCIOTECHNIC_HOME=join(home,"control");mkdirSync(process.env.SOCIOTECHNIC_HOME);const store=createMemoryStore();setStore(store);await initializeAgentVersions(store,[],[]);const repo=join(home,"repo");mkdirSync(repo);git(repo,"init","-b","main");git(repo,"config","user.name","Fixture");git(repo,"config","user.email","fixture@example.invalid");writeFileSync(join(repo,"readme.md"),"tbd\n");git(repo,"add","readme.md");git(repo,"commit","-m","fixture");const created=await createJobOperation(()=>newJob(repo,"Review evidence with an approved report deliverable",null));await effectJob(created.job,"restore",job=>{restoreWorktree(job);if(job.creation)job.creation.state="complete";});return {id:created.job,store};}
const plan=()=>JSON.parse(readFileSync(new URL("../schemas/plan.schema.json",import.meta.url),"utf8")).examples[0];
const continueWith=(r:OrchestratorRequest,groups?:string[][])=>({requestId:r.requestId,action:"continue",owner:"driver",executionGroups:r.phase==="exception"?[]:groups??r.assignments.map(d=>[d.id]),questions:[],reason:"Workload, shared writes and current commitments support these bounded groups",decomposition:[]});
const ok=(response:unknown)=>({response,outcome:"ok",usage:{input_tokens:10},note:null});

for(const parallel of [false,true])test(`supervisor actually chooses ${parallel?"parallel":"serial"} independent readers without changing frozen assignments`,async()=>{
  const f=await fixture();let plannerCalls=0,active=0,peak=0;const seen:OrchestratorRequest[]=[];
  const b=binding(async request=>{seen.push(request);return ok(continueWith(request,parallel?[request.assignments.map(d=>d.id)]:undefined));});
  const runner:Runner={name:"fake",async run(_entry,role,ctx){mkdirSync(dirname(ctx.recordPath),{recursive:true});if(role.record==="plan"){plannerCalls++;writeFileSync(ctx.recordPath,JSON.stringify(plannerCalls===1?{status:"needs-research",questions:["Evidence one?","Evidence two?"]}:plan()));}else{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,30));writeFileSync(ctx.recordPath,"STATUS: DONE\n\n## Answer\nBounded evidence report.\n\n## Evidence\n- readme.md:1 — tbd\n");active--;}return {outcome:"ok",usage:null,note:null};}};
  const before=(await f.store.storedJob(f.id))!.agentVersions;
  const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},orchestrator:b});await driver.run(f.id,"run",["planned"]);await driver.settled(f.id);
  assert.equal(driver.state(f.id).error,null);assert.equal((await f.store.storedJob(f.id))?.status,"planned");assert.equal(peak,parallel?2:1);assert.equal(plannerCalls,2);assert.deepEqual((await f.store.storedJob(f.id))!.agentVersions,before);assert.equal(seen.length,3);assert.ok(seen[1].commitments.scope==="this-driver-process");
  await readJob(f.id,()=>{for(const request of seen){const receipt=JSON.parse(session().records.get(orchestratorRecord(request))!.text);assert.equal(receipt.state,"complete");assert.equal(receipt.execution.usage.input_tokens,10);}});
});

test("supervisor veto routes owner/questions before any launch, pins config and cannot silently disappear",async()=>{
  const f=await fixture();let calls=0;const b=binding(async r=>ok({...continueWith(r),action:"escalate",owner:"human",executionGroups:[],questions:["Supply the missing target audience"],reason:"The deliverable audience is unknown"}));
  const driver=createDriverRegistry({runner:()=>({name:"fake",async run(){calls++;return {outcome:"ok",usage:null,note:null};}}),emit:()=>{},orchestrator:b});await driver.run(f.id,"run",[]);await driver.settled(f.id);
  const saved=(await f.store.storedJob(f.id))!;assert.equal(calls,0);assert.equal(saved.status,"needs-human");assert.equal(saved.dispatches[0].execution?.launch,"pending");assert.equal(saved.handoffEscalation?.issues[0].owner,"human");
  await readJob(f.id,()=>{const receipt=JSON.parse(session().records.get(saved.handoffEscalation!.record)!.text);assert.match(receipt.decision.questions[0],/target audience/);});
  await assert.rejects(mutateJob(f.id,job=>{job.orchestrator!.configuration.maxTurns++;}),/cannot change after binding/);
  const absent=createDriverRegistry({runner:()=>{throw new Error("no provider");},emit:()=>{}});await assert.rejects(absent.run(f.id,"run",[]),/requires its pinned orchestrator/);
});

test("malformed or stale supervisor response never launches and raw evidence remains",async()=>{
  for(const stale of [false,true]){
    const f=await fixture();let calls=0;
    const b=binding(async r=>{if(stale)await mutateJob(f.id,job=>stop(job,new Date().toISOString()));return ok({...continueWith(r),requestId:stale?r.requestId:"wrong-request"});});
    const driver=createDriverRegistry({runner:()=>({name:"fake",async run(){calls++;return {outcome:"ok",usage:null,note:null};}}),emit:()=>{},orchestrator:b});await driver.run(f.id,"run",[]);await driver.settled(f.id);
    const saved=(await f.store.storedJob(f.id))!;assert.equal(calls,0);assert.equal(saved.status,stale?"stopped":"needs-human");
    await readJob(f.id,()=>{const row=[...session().records.values()].find(r=>r.path.startsWith("orchestrator/"))!;const receipt=JSON.parse(row.text);assert.equal(receipt.execution.response.requestId,stale?receipt.request.requestId:"wrong-request");assert.equal(receipt.execution.usage.input_tokens,10);assert.equal(receipt.state,stale?"stale":"failed");});
  }
});

test("original builder blocker reaches supervisor after explicit plan approval and continue cannot release it",async()=>{
  const f=await fixture();const seen:OrchestratorRequest[]=[];let calls=0;
  const b=binding(async r=>{seen.push(r);return ok(continueWith(r));});
  const runner:Runner={name:"fake",async run(_entry,role,ctx){calls++;mkdirSync(dirname(ctx.recordPath),{recursive:true});writeFileSync(ctx.recordPath,role.record==="plan"?JSON.stringify(plan()):`STATUS: BLOCKED\nCOMMIT: ${git(ctx.worktree,"rev-parse","HEAD")}\n\n## Summary\nNo speculative implementation.\n\n## Acceptance\n- [ ] Required scope remains unresolved.\n\n## Deviations\n- none\n\n## Notes for reviewers\nNo changes made.\n\n## Blocker\nWhich audience should the report address?\n`);return {outcome:"ok",usage:null,note:null};}};
  const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},orchestrator:b});await driver.run(f.id,"run",["planned"]);await driver.settled(f.id);assert.equal(calls,1);assert.equal(seen.length,1);
  await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(calls,2);assert.equal(driver.state(f.id).error,null);assert.equal((await f.store.storedJob(f.id))!.status,"needs-human");const exception=seen.at(-1)!;assert.equal(exception.phase,"exception");assert.ok(exception.artifacts.some(a=>a.text.includes("Which audience should the report address?")));assert.equal(exception.workload.stages,1);assert.equal(exception.workload.estimatedMinutes,null);
});

test("stopping during supervisor review leaves workers pending and does not repeat an uncertain call",{timeout:10000},async()=>{
  const f=await fixture();let reviews=0,signalSeen:()=>void=()=>{};const started=new Promise<void>(resolve=>{signalSeen=resolve;});
  const b=binding(async(r,signal)=>{reviews++;signalSeen();if(reviews>1)return ok(continueWith(r));return new Promise(resolve=>{signal.addEventListener("abort",()=>resolve(ok(continueWith(r))),{once:true});});});
  const runner:Runner={name:"fake",async run(){throw new Error("must not launch");}};
  const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},orchestrator:b});await driver.run(f.id,"run",[]);await started;driver.stop(f.id);await driver.settled(f.id);assert.equal(reviews,1);assert.equal((await f.store.storedJob(f.id))!.dispatches[0].execution?.launch,"pending");
  process.env.SOCIOTECHNIC_LOCAL_MAX_DISPATCHES="2";await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(reviews,1);assert.equal((await f.store.storedJob(f.id))!.status,"needs-human");
  await readJob(f.id,()=>{const cancelled=[...session().records.values()].map(r=>r.path.startsWith("orchestrator/")?JSON.parse(r.text):null).find(r=>r?.execution);assert.equal(cancelled.execution.usage.input_tokens,10);});
});

test("opted-in invalid build body repairs within existing caps and retains raw rejected evidence",async()=>{
  const f=await fixture();let builds=0;const b=binding(async r=>ok(continueWith(r)));
  const runner:Runner={name:"fake",async run(entry,role,ctx){mkdirSync(dirname(ctx.recordPath),{recursive:true});
    const snapshot=JSON.parse(readFileSync(join(ctx.inputRoot!,"job.json"),"utf8"));assert.equal(snapshot.contextVersion,1);assert.equal(snapshot.agentConfigurations,undefined);assert.equal(snapshot.dispatches.filter(Boolean).length,1);assert.equal(snapshot.dispatches.find(Boolean).execution,undefined);
    if(role.record==="plan")writeFileSync(ctx.recordPath,JSON.stringify(plan()));
    else {assert.equal(role.record,"build");builds++;if(builds>1){assert.match(entry.prompt,/recipient-contract: sections.Summary/);const handoff=JSON.parse(readFileSync(join(ctx.inputRoot!,"contracts/handoff.json"),"utf8"));assert.ok(handoff.artifacts.some((a:{record:string})=>a.record.includes("superseded-by")));assert.ok(handoff.artifacts.some((a:{record:string})=>a.record.startsWith("handoff/validation/")));assert.match(handoff.output.schema,/recipient-contract.v1.json/);assert.equal(handoff.output.validator.module,"src/recipient-contract.ts");}
      writeFileSync(ctx.recordPath,`STATUS: READY\nCOMMIT: ${git(ctx.worktree,"rev-parse","HEAD")}\n`);
    }return {outcome:"ok",usage:null,note:null};}};
  const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},orchestrator:b});await driver.run(f.id,"run",["planned"]);await driver.settled(f.id);await driver.run(f.id,"run",[]);await driver.settled(f.id);
  const saved=(await f.store.storedJob(f.id))!;assert.equal(driver.state(f.id).error,null);assert.equal(saved.status,"needs-human");assert.match(saved.statusReason,/retry-bound:build/);assert.equal(builds,saved.caps.retriesPerStep+1);assert.ok(saved.dispatches.filter(d=>d.step==="build").every(d=>d.parsed?.kind==="malformed"));assert.equal(saved.dispatches.filter(d=>d.step==="review").length,0);
  await readJob(f.id,()=>{const errors=[...session().records.values()].filter(r=>r.path.startsWith("handoff/validation/"));assert.equal(errors.length,builds);assert.ok(JSON.parse(errors[0].text).errors.some((e:{field:string})=>e.field==="sections.Summary"));assert.ok([...session().records.keys()].some(path=>path.includes("build.md.superseded-by")));});
});
