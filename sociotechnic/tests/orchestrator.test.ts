import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { bindOrchestrator, orchestratorProfile, validateOrchestratorDecision } from "../src/orchestrator.ts";
import type { OrchestratorRequest } from "../src/orchestrator.ts";
import { binding } from "./helpers/orchestrator-binding.ts";
import { readCatalogBundles } from "../src/db/catalog-migrations.ts";
import type { Job } from "../src/job.ts";
import { runnerOrchestrator, solOrchestrator } from "../ui/orchestrator-runner.ts";


function request(): OrchestratorRequest {
  const b = binding(async () => ({response:null,outcome:"failed",usage:null,note:null}));
  return { schemaVersion: 1, requestId: `sha256:${"a".repeat(64)}`, reviewKey: "wave", stateDigest: "state", phase: "assignments", controller: orchestratorProfile(b), job: {id:"20261026-fixture",feature:"Review evidence",status:"researching",repo:"/repo",worktree:"/worktree",branch:"sociotechnic/fixture"}, workload: { approvedPlan: { stages: [{id:"s1"},{id:"s2"}] }, stages:2,touchedPatterns:1,acceptanceChecks:2,tier:"EASY",risks:[],estimatedMinutes:null,estimateSource:"not-recorded" }, commitments: {scope:"this-driver-process",active:[],queued:0,limit:2}, team: [], assignments: ["d-001","d-002"].map(id => ({id,agent:"sociotechnic-researcher",model:"gpt-6-luna",effort:"high",deadlineAt:"2099-01-01T00:00:00Z",record:`${id}.md`,prompt:"Read bounded evidence"})), issues:[], artifacts:[],allowedOwners:["human","driver","sociotechnic-researcher"],parallelEligible:["d-001","d-002"] };
}
const decision = (r: OrchestratorRequest) => ({requestId:r.requestId,action:"continue",owner:"driver",executionGroups:[["d-001","d-002"]],questions:[],reason:"Independent evidence reads may overlap within capacity",decomposition:[]});

test("typed decisions permit serial or parallel readers but reject missing, duplicate, unsafe and stale work",()=>{
  const r=request();assert.deepEqual(validateOrchestratorDecision(decision(r),r),[]);
  assert.deepEqual(validateOrchestratorDecision({...decision(r),executionGroups:[["d-001"],["d-002"]]},r),[]);
  for(const changes of [{executionGroups:[["d-001"]]},{executionGroups:[["d-001","d-001","d-002"]]},{requestId:"stale"},{tools:["Bash"]},{questions:["Unknown scope?"]},{owner:"invented"},{decomposition:[{stages:["s1","s1"],owner:"driver",deliverable:"same",rationale:"bad"}]}])assert.ok(validateOrchestratorDecision({...decision(r),...changes},r).length,JSON.stringify(changes));
  r.parallelEligible=["d-001"];assert.ok(validateOrchestratorDecision(decision(r),r).some(e=>e.code==="shared-write-hazard"));
  assert.deepEqual(validateOrchestratorDecision({...decision(r),executionGroups:[["d-001"],["d-002"]]},r),[]);
});

test("exception decisions never authorize launches and decomposition references approved stages only",()=>{
  const r=request();r.phase="exception";
  assert.ok(validateOrchestratorDecision(decision(r),r).some(e=>e.code==="assignment-mismatch"));
  const d={...decision(r),action:"escalate",executionGroups:[],owner:"human",questions:["Which missing artifact should be supplied?"],decomposition:[{stages:["s1"],owner:"driver",deliverable:"Narrow report",rationale:"Keep one owner for shared writes"}]};
  assert.deepEqual(validateOrchestratorDecision(d,r),[]);
  assert.ok(validateOrchestratorDecision({...d,decomposition:[{...d.decomposition[0],stages:["unapproved"]}]},r).some(e=>e.field==="decomposition[0]"));
});

test("real runner adapter stages referenced contract and evidence, uses explicit profile, captures usage and cleans its own files",async()=>{
  const r=request();r.artifacts=[{record:"research/answer.md",bytes:8,sha256:"digest",text:"Evidence",encoding:"utf8"}];let root="";
  const b=binding(async()=>({response:null,outcome:"failed",usage:null,note:null}));
  const transport=runnerOrchestrator({...b,runner:()=>({name:"fake",async run(entry,role,ctx){
    root=ctx.inputRoot!;assert.equal(entry.model,b.configuration.model);assert.equal(role.name,b.agent);assert.deepEqual(role.tools,["Read","Grep","Glob","Write"]);assert.match(entry.prompt,/decision.schema.json/);
    const index=JSON.parse(readFileSync(`${root}/request.json`,"utf8"));assert.equal(index.artifacts[0].text,undefined);assert.equal(readFileSync(index.artifacts[0].path,"utf8"),"Evidence");assert.equal(index.controller.configuration,undefined);
    const shape=JSON.parse(readFileSync(`${root}/decision.schema.json`,"utf8"));assert.ok(shape.required.includes("executionGroups"));
    writeFileSync(ctx.recordPath,JSON.stringify(decision(r)));return {outcome:"ok",usage:{input_tokens:50,cached_input_tokens:20},note:null};
  }})});
  const result=await transport.review(r,new AbortController().signal);assert.deepEqual(result.response,decision(r));assert.deepEqual(result.usage,{input_tokens:50,cached_input_tokens:20});assert.equal(existsSync(root),false);
});

test("configuration has no model fallback or permission expansion",()=>{
  const b=binding(async()=>({response:null,outcome:"failed",usage:null,note:null}));
  assert.throws(()=>orchestratorProfile({...b,configuration:{...b.configuration,definition:undefined}}),/explicit versioned/);
  assert.throws(()=>orchestratorProfile({...b,configuration:{...b.configuration,model:"invalid"}}));
  assert.throws(()=>orchestratorProfile({...b,configuration:{...b.configuration,baseRole:"sociotechnic-builder"}}),/read-only/);
});


test("selected Sol/high candidate binds the real adapter without catalog import and refuses host execution for sandbox runs",()=>{
  const selected=solOrchestrator(()=>{throw new Error("Instantiation must not launch a provider");});
  assert.equal(selected.configuration.model,"gpt-6.1-sol");assert.equal(selected.configuration.effort,"high");assert.equal(selected.agent,"sociotechnic-orchestrator");
  assert.equal(readCatalogBundles().some(bundle=>bundle.releases.some(row=>row.agent===selected.agent)),false);
  const job={execution:{kind:"docker-sandbox"},dispatches:[]} as unknown as Job;
  assert.throws(()=>bindOrchestrator(job,selected),/cannot dispatch a supervisor provider on the host/);
});
