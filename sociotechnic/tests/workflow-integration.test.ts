import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { initializeAgentVersions } from "../src/agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { accept, newJob, step } from "../src/engine.ts";
import { createJobOperation, effectJob, mutateJob, readJob } from "../src/job-store.ts";
import { restoreWorktree } from "../src/db/restore.ts";
import { orchestratorProfile } from "../src/orchestrator.ts";
import { session } from "../src/record-store.ts";
import { answerWorkflow, initializeWorkflow } from "../src/workflow-runtime.ts";
import { loadWorkflow } from "../src/workflow.ts";
import { createDriverRegistry } from "../ui/driver.ts";
import type { WorkflowLeadRequest } from "../src/workflow-lead.ts";
import type { WorkflowLeadRunner } from "../ui/workflow-lead-runner.ts";
import type { Runner } from "../ui/runner.ts";
import { binding } from "./helpers/orchestrator-binding.ts";
const homes:string[]=[],oldHome=process.env.SOCIOTECHNIC_HOME;
afterEach(()=>{setStore(null);if(oldHome===undefined)delete process.env.SOCIOTECHNIC_HOME;else process.env.SOCIOTECHNIC_HOME=oldHome;for(const home of homes.splice(0))rmSync(home,{recursive:true,force:true});});
const git=(cwd:string,...args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","core.fsmonitor=false","-C",cwd,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const read=(url:string)=>JSON.parse(readFileSync(new URL(url,import.meta.url),"utf8"));
const plan=()=>read("../schemas/plan.schema.json").examples[0];
async function fixture(){const home=mkdtempSync(join(tmpdir(),"sociotechnic-workflow-"));homes.push(home);process.env.SOCIOTECHNIC_HOME=join(home,"control");mkdirSync(process.env.SOCIOTECHNIC_HOME);const store=createMemoryStore();setStore(store);await initializeAgentVersions(store,[],[]);const repo=join(home,"repo");mkdirSync(repo);git(repo,"init","-b","main");git(repo,"config","user.name","Fixture");git(repo,"config","user.email","fixture@example.invalid");mkdirSync(join(repo,"src"));writeFileSync(join(repo,"src/x.ts"),"export const x=1;\n");writeFileSync(join(repo,".sociotechnic.json"),JSON.stringify({checks:[{name:"syntax",run:"node --check src/x.ts",timeoutSeconds:5}]}));git(repo,"add",".");git(repo,"commit","-m","fixture");const out=await createJobOperation(async()=>{const out=await newJob(repo,"Set x to2 and retain the API",null);initializeWorkflow(session().job!,loadWorkflow(),orchestratorProfile(binding(async()=>{throw new Error("legacy wave reviewer must not run");})));return out;});await effectJob(out.job,"restore",job=>{restoreWorktree(job);if(job.creation)job.creation.state="complete";});return {id:out.job,store};}
const choices=(r:WorkflowLeadRequest)=>r.requiredSlots.map(slot=>r.currentSelections.find(c=>c.slot===slot)!);
const answer=(r:WorkflowLeadRequest)=>r.phase==="intake"?{status:"ready",brief:"Keep the existing API. Set x to2; planner defines scoped acceptance.",selections:choices(r)}:r.phase==="assignment"?{status:"ready",reason:"One writer, independent technical readers.",selections:choices(r),concurrency:{...r.nodeLimits,reviews:2}}:r.phase==="exception"?{status:"needs-input",questions:["Resolve the precise blocked evidence before resuming."]}:{status:"aligned",summary:"The checked implementation preserves the requested API and x is2.",findings:[]};
const ok=(response:unknown)=>({response,outcome:"ok",usage:{input_tokens:10},note:null});
const worker=(onCall?:(kind:string)=>void):Runner=>({name:"fake",async run(_entry,role,ctx){onCall?.(role.record);mkdirSync(dirname(ctx.recordPath),{recursive:true});if(role.record==="plan")writeFileSync(ctx.recordPath,JSON.stringify(plan()));else {if(role.record==="build"){writeFileSync(join(ctx.worktree,"src/x.ts"),"export const x=2;\n");git(ctx.worktree,"add","src/x.ts");git(ctx.worktree,"commit","-m","implement");}const head=git(ctx.worktree,"rev-parse","HEAD");const contract=read("../schemas/recipient-contract.v1.json").$defs[role.record];let text=contract.examples[0].replaceAll("0123456789abcdef0123456789abcdef01234567",head);if(role.record==="conformance")text=text.replace(/\| s2 \|[^\n]*\n/,"");writeFileSync(ctx.recordPath,text);}return {outcome:"ok",usage:null,note:null};}});

test("executable default runs intake/planner/assignment, holds approval, then technical gates and intent review",async()=>{
 const f=await fixture(),phases:string[]=[],workers:string[]=[];const pins=(await f.store.storedJob(f.id))!.agentVersions;
 const lead:WorkflowLeadRunner=async r=>{phases.push(r.phase);assert.ok(r.evidence.some(e=>e.record==="workflow/guide.md"));return ok(answer(r));};
 const driver=createDriverRegistry({runner:()=>worker(kind=>workers.push(kind)),workflowLead:lead,emit:()=>{}});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(driver.state(f.id).error,null);
 let saved=(await f.store.storedJob(f.id))!;assert.equal(saved.status,"planned");assert.equal(saved.workflow!.phase,"approval");assert.deepEqual(phases,["intake","assignment"]);assert.deepEqual(workers,["plan"]);
 await mutateJob(f.id,async job=>{const stopped=await step(job);assert.equal(stopped.action,"human");assert.match(stopped.action==="human"?stopped.reason:"",/Approve/);assert.throws(()=>accept(job,"no"),/Approve/);});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(driver.state(f.id).error,null);saved=(await f.store.storedJob(f.id))!;
 assert.equal(saved.status,"ready",saved.statusReason);assert.equal(saved.workflow!.intent?.status,"aligned");assert.deepEqual(phases,["intake","assignment","intent-review"]);assert.ok(workers.includes("conformance"));assert.ok(workers.includes("decision"));assert.deepEqual(saved.agentVersions,pins);
 await assert.rejects(mutateJob(f.id,job=>{delete job.workflow!.selections["sociotechnic-planner"];}),/cannot change after use/);
 await assert.rejects(mutateJob(f.id,job=>{job.workflow!.profile.configuration.maxTurns++;}),/cannot change after binding/);
 await readJob(f.id,()=>{assert.ok([...session().records.values()].filter(r=>r.path.startsWith("workflow/calls/")).every(r=>JSON.parse(r.text).execution.usage.input_tokens===10));});
 await mutateJob(f.id,job=>accept(job,"Human independently accepts"));assert.equal((await f.store.storedJob(f.id))!.status,"accepted");
});

test("intake questions bind one answer and stale/duplicate answers never advance",async()=>{
 const f=await fixture();let count=0;const driver=createDriverRegistry({runner:()=>worker(),emit:()=>{},workflowLead:async r=>{count++;return ok(count===1?{status:"needs-input",questions:["Which compatibility target?"]}:answer(r));}});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);let job=(await f.store.storedJob(f.id))!;assert.equal(job.status,"needs-human");assert.equal(job.dispatches.length,0);const id=job.workflow!.pending!.requestId;
 await assert.rejects(mutateJob(f.id,j=>answerWorkflow(j,"wrong","Node24",new Date().toISOString())),/no longer pending/);
 await mutateJob(f.id,j=>answerWorkflow(j,id,"Node24",new Date().toISOString()));await assert.rejects(mutateJob(f.id,j=>answerWorkflow(j,id,"Again",new Date().toISOString())),/no longer pending/);
 await driver.run(f.id,"run",[]);await driver.settled(f.id);job=(await f.store.storedJob(f.id))!;assert.equal(job.status,"planned");assert.equal(job.workflow!.conversation[0].answer,"Node24");assert.equal(driver.state(f.id).error,null);
});

test("malformed lead selections repair within existing bound and retain precise errors without planner launch",async()=>{
 const f=await fixture();let calls=0,launches=0;const driver=createDriverRegistry({runner:()=>worker(()=>launches++),emit:()=>{},workflowLead:async()=>{calls++;return ok({status:"ready",brief:"Brief",selections:[]});}});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);const job=(await f.store.storedJob(f.id))!;assert.equal(calls,job.caps.retriesPerStep+1);assert.equal(launches,0);assert.equal(job.status,"needs-human");
 await readJob(f.id,()=>{assert.ok([...session().records.values()].some(r=>r.path.startsWith("workflow/calls/")&&JSON.parse(r.text).errors.some((e:string)=>e.startsWith("selections:"))));});
});

test("uncertain call is fenced across changed held status and restart; stopped work is never applied",async()=>{
 const f=await fixture();await mutateJob(f.id,job=>{const flow=job.workflow!;flow.calls.push({id:"w-1",phase:"intake",round:0,key:"old-context",state:"started",record:"workflow/calls/w-1.json"});session().records.set("workflow/calls/w-1.json",{path:"workflow/calls/w-1.json",text:JSON.stringify({round:0,state:"started"}),bytes:0,mtime:new Date().toISOString()});});
 let calls=0;const driver=createDriverRegistry({runner:()=>worker(),emit:()=>{},workflowLead:async r=>{calls++;return ok(answer(r));}});
 for(let i=0;i<2;i++){await driver.run(f.id,"run",[]);await driver.settled(f.id);}assert.equal(calls,0);assert.match((await f.store.storedJob(f.id))!.statusReason,/prior workflow call/);
});

for(const verdict of ["needs-input","changes"] as const)test(`intent ${verdict} retains evidence and a legal human gate`,async()=>{
 const f=await fixture();let intent=0;const lead:WorkflowLeadRunner=async r=>{
  if(r.phase!=="intent-review")return ok(answer(r));intent++;
  return ok(intent===1?(verdict==="needs-input"?{status:"needs-input",questions:["Confirm the API target matches your intent?"]}:{status:"changes",summary:"The intended API target needs correction",findings:["The customer wanted a different API target."]}):answer(r));
 };
 const driver=createDriverRegistry({runner:()=>worker(),emit:()=>{},workflowLead:lead});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);await driver.run(f.id,"run",[]);await driver.settled(f.id);
 let job=(await f.store.storedJob(f.id))!;assert.equal(driver.state(f.id).error,null);assert.equal(job.status,"needs-human");assert.ok(job.workflow!.calls.some(c=>c.phase==="intent-review"&&c.state==="complete"));await assert.rejects(mutateJob(f.id,j=>accept(j,"cannot waive")),/Workflow lead/);
 if(verdict==="needs-input"){
  await mutateJob(f.id,j=>answerWorkflow(j,j.workflow!.pending!.requestId,"Confirmed",new Date().toISOString()));assert.equal((await f.store.storedJob(f.id))!.status,"ready");
  await driver.run(f.id,"run",[]);await driver.settled(f.id);job=(await f.store.storedJob(f.id))!;assert.equal(job.status,"ready");assert.equal(job.workflow!.intent!.status,"aligned");assert.equal(intent,2);
 }
});

test("pending planner recovery launches once before reviewer concurrency is selected",async()=>{
 const f=await fixture();await mutateJob(f.id,async job=>{job.workflow!.phase="planning";job.workflow!.selections["sociotechnic-planner"]=job.agentConfigurations!["sociotechnic-planner"];job.workflow!.briefRecord="workflow/project-brief.md";session().records.set("workflow/project-brief.md",{path:"workflow/project-brief.md",text:"Factual brief",bytes:13,mtime:new Date().toISOString()});const result=await step(job);assert.equal(result.action,"dispatch");});
 let planner=0;const driver=createDriverRegistry({runner:()=>worker(kind=>{if(kind==="plan")planner++;}),workflowLead:async r=>ok(answer(r)),emit:()=>{}});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(driver.state(f.id).error,null);assert.equal(planner,1);assert.equal((await f.store.storedJob(f.id))!.workflow!.phase,"approval");
});

test("pausing a bounded reader queue awaits its active worker without launching later readers",async()=>{
 const f=await fixture();let readers=0,signalStart:()=>void=()=>{},release:()=>void=()=>{};
 const started=new Promise<void>(r=>{signalStart=r;}),waiting=new Promise<void>(r=>{release=r;});const base=worker();
 const runner:Runner={name:"fake",async run(entry,role,ctx){if(role.record==="review"||role.record==="conformance"){readers++;if(readers===1){signalStart();await waiting;}}return base.run(entry,role,ctx);}};
 const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},workflowLead:async r=>ok(r.phase==="assignment"?{...answer(r),concurrency:{...r.nodeLimits,reviews:1}}:answer(r))});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);await driver.run(f.id,"run",[]);await started;driver.pause(f.id);release();await driver.settled(f.id);
 assert.equal(readers,1);const job=(await f.store.storedJob(f.id))!;assert.ok(job.dispatches.some(d=>d.step==="review"&&!d.finishedAt&&d.execution?.launch==="pending"));
});

test("blocked builder questions reach lead with exact evidence; answering stays held for explicit rework",async()=>{
 const f=await fixture(),seen:WorkflowLeadRequest[]=[];let calls=0;const base=worker();
 const runner:Runner={name:"fake",async run(entry,role,ctx){calls++;if(role.record!=="build")return base.run(entry,role,ctx);mkdirSync(dirname(ctx.recordPath),{recursive:true});writeFileSync(ctx.recordPath,`STATUS: BLOCKED\nCOMMIT: ${git(ctx.worktree,"rev-parse","HEAD")}\n\n## Summary\nStopped with exact evidence.\n\n## Acceptance\n- [ ] Clarify the intended target.\n\n## Deviations\n- none\n\n## Notes for reviewers\nNo guess was made.\n\n## Blocker\nWhich API target should own this file?\n`);return {outcome:"ok",usage:null,note:null};}};
 const driver=createDriverRegistry({runner:()=>runner,emit:()=>{},workflowLead:async r=>{seen.push(r);return ok(answer(r));}});
 await driver.run(f.id,"run",[]);await driver.settled(f.id);await driver.run(f.id,"run",[]);await driver.settled(f.id);assert.equal(driver.state(f.id).error,null);
 const exception=seen.find(r=>r.phase==="exception")!;assert.ok(exception.evidence.some(e=>e.text.includes("Which API target should own this file?")));
 await mutateJob(f.id,job=>answerWorkflow(job,job.workflow!.pending!.requestId,"Use existing src/x.ts",new Date().toISOString()));
 await assert.rejects(driver.run(f.id,"run",[]),/human gate/);assert.equal(calls,2);assert.equal(seen.filter(r=>r.phase==="exception").length,1);
});
