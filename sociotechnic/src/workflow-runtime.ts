import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfiguration } from "./agent-catalog.ts";
import { canonicalJson } from "./agent-version-data.ts";
import { recordBytes } from "./db/store.ts";
import { IllegalTransition, SociotechnicError } from "./errors.ts";
import { effectiveCap, park, transition } from "./job.ts";
import type { Job, Status } from "./job.ts";
import type { OrchestratorProfile, OrchestratorRun } from "./orchestrator.ts";
import { jobDir } from "./paths.ts";
import { readJson, readText, session, writeJsonAtomic, writeTextAtomic } from "./record-store.ts";
import { BUILDER_BY_TIER, LENSES, lensAgent } from "./roles.ts";
import { resolveWorkflowSelections } from "./workflow-selection.ts";
import { validateWorkflowLeadReply } from "./workflow-lead.ts";
import type { WorkflowAssignmentReply, WorkflowIntakeReply, WorkflowIntentReply, WorkflowLeadPhase, WorkflowLeadReply, WorkflowLeadRequest, WorkflowQuestion } from "./workflow-lead.ts";
import { workflowDigest } from "./workflow.ts";
import type { WorkflowDefinition } from "./workflow.ts";

export type WorkflowCall = { id: string; phase: WorkflowLeadPhase; round:number; key: string; state: "pending" | "started" | "complete" | "failed" | "stale"; record: string };
export type WorkflowRun = {
  definition: WorkflowDefinition; digest: string; profile: OrchestratorProfile;
  selections: Record<string,AgentConfiguration>; concurrency: Record<string,number>;
  phase: "intake" | "planning" | "assignment" | "approval" | "execution" | "intent-review" | "complete";
  briefRecord?: string; assignmentRecord?: string; assignmentDigest?: string;
  planApproval?: { planDigest: string; assignmentDigest: string; at: string };
  intent?: { commit: string; round: number; status: "aligned" | "changes"; record: string };
  pending?: { requestId: string; phase: string; questions: string[]; resumeStatus: Status };
  conversation: WorkflowQuestion[]; calls: WorkflowCall[];
};
const sha=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
const path=(job:Job,record:string)=>join(jobDir(job.id),record);
const EXPECTED=["lead","selected.planner","lead","approve-plan-and-assignment","selected.builder","canonical-checks","selected.reviewers","commit-and-evidence-gate","selected.approver","lead","accept-result"];

export function executableWorkflow(definition:WorkflowDefinition): string[] {
  // Revalidate persisted JSON through the same parser, without accepting new execution semantics.
  const order:string[]=[];let cursor=definition.entry;
  while(cursor!=="done") {if(order.includes(cursor)||!definition.nodes[cursor])throw new SociotechnicError("workflow-unsupported","Workflow has no supported execution route");order.push(cursor);cursor=definition.nodes[cursor].next;}
  if(order.length!==EXPECTED.length||order.some((id,i)=>{const node=definition.nodes[id];return (node.agent??node.mechanical??node.human)!==EXPECTED[i];}))throw new SociotechnicError("workflow-unsupported","This runtime executes the default intake/plan/assign/approval/build/check/review/gate/technical-approval/intent/accept sequence only");
  // These ports map to concrete retained records, not an arbitrary graph interpreter.
  const refs=["engine:project-brief@1","sociotechnic/schemas/plan.schema.json#/$defs/plan","engine:execution-assignment@1","engine:human-approval@1","sociotechnic/schemas/recipient-contract.v1.json#/$defs/build","engine:checks-report@1","engine:review-bundle@1","engine:quality-gate@1","sociotechnic/schemas/recipient-contract.v1.json#/$defs/decision","engine:intent-review@1","engine:human-approval@1"];
  const outputs=["brief","plan","assignment","approval","build","checks","reviews","gate","decision","intent-review","approval"];
  const inputs: [string,number][] []=[[["intent",-1]],[["brief",0]],[["intent",-1],["brief",0],["plan",1]],[["plan",1],["assignment",2]],[["plan",1],["assignment",2],["approval",3]],[["build",4]],[["plan",1],["build",4],["checks",5]],[["build",4],["checks",5],["reviews",6]],[["gate",7]],[["intent",-1],["plan",1],["build",4],["decision",8]],[["intent-review",9]]];
  order.forEach((id,index)=>{
    const node=definition.nodes[id];
    if(canonicalJson(Object.keys(node.out))!==canonicalJson([outputs[index]])||definition.contracts[node.out[outputs[index]]]!==refs[index])throw new SociotechnicError("workflow-unsupported",`nodes.${id}.out: This executable adapter requires its exact versioned output port`);
    if(canonicalJson(Object.keys(node.in).sort())!==canonicalJson(inputs[index].map(([port])=>port).sort()))throw new SociotechnicError("workflow-unsupported",`nodes.${id}.in: Unsupported adapter inputs`);
    for(const [port,producer] of inputs[index]){
      const from=producer<0?"run.intent":`${order[producer]}.${outputs[producer]}`;
      const ref=producer<0?"engine:job-intent@1":refs[producer];
      if(node.in[port].from!==from||definition.contracts[node.in[port].contract]!==ref)throw new SociotechnicError("workflow-unsupported",`nodes.${id}.in.${port}: This adapter cannot consume the selected producer/contract`);
    }
  });
  return order;
}

export function initializeWorkflow(job:Job,definition:WorkflowDefinition,profile:OrchestratorProfile):void {
  if(job.workflow||job.dispatches.length||job.status!=="new")throw new IllegalTransition("Select a workflow before the first dispatch");
  if(job.execution?.kind==="docker-sandbox")throw new SociotechnicError("workflow-unsupported","Workflow lead v1 is local-only; sandbox work cannot be moved to the host");
  executableWorkflow(definition);
  if(profile.configuration.model!=="gpt-6.1-sol"||profile.configuration.effort!=="high")throw new SociotechnicError("workflow-unsupported","The selected workflow lead is GPT-6.1 Sol/high");
  job.workflow={definition:structuredClone(definition),digest:workflowDigest(definition),profile:structuredClone(profile),phase:"intake",selections:{},concurrency:{},conversation:[],calls:[]};
  writeJsonAtomic(path(job,"workflow/definition.json"),definition);
  writeTextAtomic(path(job,"workflow/guide.md"),readFileSync(new URL("../skills/orchestrator-workflow/SKILL.md",import.meta.url),"utf8"));
}

export function workflowBarrier(job:Job):string|null {
  const flow=job.workflow;if(!flow)return null;
  if(workflowDigest(flow.definition)!==flow.digest)return "Workflow definition differs from its pinned digest";
  if(["stopped","accepted","merged"].includes(job.status))return null;
  if(flow.pending)return "Workflow lead is waiting for the exact pending human answer";
  if(flow.phase==="intake")return "Workflow intake must complete before the planner dispatch";
  if(!flow.briefRecord||!flow.selections["sociotechnic-planner"])return "workflow.intake: Required project brief or planner selection is absent";
  if((job.status==="planned"||job.round>0)&&(!flow.briefRecord||!flow.assignmentRecord||!flow.assignmentDigest||!job.plan||flow.planApproval?.planDigest!==job.plan.digest||flow.planApproval.assignmentDigest!==flow.assignmentDigest))return "Approve the pinned plan and workflow assignment before execution";
  if(["ready","needs-human","merged-local"].includes(job.status)){
    const approved=[...job.dispatches].reverse().find(d=>d.step==="approve"&&d.round===job.round&&d.outcome==="ok"&&d.parsed?.kind==="ok"&&d.parsed.effective==="APPROVE");
    const commit=approved?.parsed&&"commit" in approved.parsed?approved.parsed.commit:null;
    if(!flow.intent||flow.intent.status!=="aligned"||flow.intent.round!==job.round||flow.intent.commit!==commit)return "Workflow lead must verify the current technical result against customer intent before acceptance or merge";
  }
  return null;
}

export function approveWorkflow(job:Job,now:string):void {
  const f=job.workflow;if(!f||f.phase!=="approval")return;
  if(job.status!=="planned"||!job.plan||!f.assignmentDigest||f.pending)throw new IllegalTransition("Workflow plan and assignment are not ready for approval");
  f.planApproval={planDigest:job.plan.digest,assignmentDigest:f.assignmentDigest,at:now};f.phase="execution";
  job.human.push({at:now,action:"workflow-approve",note:canonicalJson(f.planApproval)});
  writeJsonAtomic(path(job,"workflow/plan-approval.json"),f.planApproval);
}

export function answerWorkflow(job:Job,requestId:string,answer:string,now:string):{job:string;status:Status} {
  const f=job.workflow,pending=f?.pending;
  if(!f||!pending||pending.requestId!==requestId||job.status!=="needs-human")throw new SociotechnicError("workflow-stale","This exact workflow question is no longer pending; refresh before replying");
  if(typeof answer!=="string"||!answer.trim()||answer.length>16000)throw new SociotechnicError("usage","Answer must contain 1 to16000 characters");
  const conversation=f.conversation.find(c=>c.requestId===requestId);
  if(!conversation||conversation.answer!==undefined)throw new SociotechnicError("workflow-stale","This workflow question was already answered");
  conversation.answer=answer.trim();delete f.pending;
  job.human.push({at:now,action:"workflow-answer",note:canonicalJson({requestId,answer:answer.trim()})});
  if(pending.resumeStatus!=="needs-human")transition(job,pending.resumeStatus,"Workflow answer recorded",now);
  return {job:job.id,status:job.status};
}

export function workflowPhase(job:Job):WorkflowLeadPhase|null {
  const f=job.workflow;if(!f||f.pending||["stopped","accepted","merged","merged-local"].includes(job.status))return null;
  if(f.phase==="intake")return "intake";
  if(job.status==="planned"&&f.phase==="planning")f.phase="assignment";
  if(f.phase==="assignment")return "assignment";
  if(job.status==="ready"&&(!f.intent||f.intent.round!==job.round)) {f.phase="intent-review";return "intent-review";}
  if(job.status==="needs-human"){
    const prior=[...f.calls].reverse().find(call=>call.phase==="exception"&&call.round===job.round&&call.state==="complete");
    if(prior&&f.conversation.some(c=>c.requestId===prior.key&&c.answer!==undefined))return null;
    return "exception";
  }
  return null;
}

export function workflowRequest(job:Job,phase:WorkflowLeadPhase):WorkflowLeadRequest {
  const f=job.workflow!;const order=executableWorkflow(f.definition);
  const slots=phase==="intake"?["sociotechnic-planner"]:phase==="assignment"?[
    BUILDER_BY_TIER[job.plan!.tier],...LENSES.map(lensAgent),"sociotechnic-approver",
  ]:[];
  const needed=new Set(["workflow/guide.md",...(f.briefRecord?[f.briefRecord]:[]),...(f.assignmentRecord?[f.assignmentRecord]:[])]);
  if(phase==="intent-review"||phase==="exception"){
    for(const d of job.dispatches)if(d.round===job.round&&d.finishedAt)needed.add(d.record);
    for(const r of job.rounds)if(r.n===job.round&&r.checks)needed.add(r.checks.path);
    if(job.handoffEscalation)needed.add(job.handoffEscalation.record);
    needed.add(`round-${job.round}/changed-files.txt`);needed.add(`round-${job.round}/diff.patch`);
  }
  const evidence=[...session().records.values()].filter(r=>needed.has(r.path)).map(r=>({record:r.path,text:r.text,...(r.encoding==="base64"?{encoding:"base64" as const}:{}),sha256:createHash("sha256").update(recordBytes(r)).digest("hex")}));
  const request={schemaVersion:1 as const,phase,job:{id:job.id,originalIntent:job.feature,repo:job.repo,worktree:job.worktree,branch:job.branch},workflow:{name:f.definition.name,digest:f.digest},
    brief:f.briefRecord?readText(path(job,f.briefRecord)):null,plan:job.plan?readJson(path(job,"plan.json")):null,planDigest:job.plan?.digest??null,
    resources:job.agentRoster??[],lockedSlots:job.agentLocks??[],currentSelections:Object.entries({...job.agentConfigurations,...f.selections}).map(([slot,c])=>({slot,agent:c.agentName??slot,version:c.version})),requiredSlots:slots,
    nodeLimits:phase==="assignment"?Object.fromEntries(order.map(id=>[id,f.definition.nodes[id].concurrency])):{},conversation:f.conversation,evidence,
    // Actual tool/deadline caps are in immutable profile/capability cards, not guesses.
    context:{round:job.round,status:job.status,reason:job.statusReason,caps:job.caps,overrides:job.overrides},
  };
  return {...request,requestId:`sha256:${sha(request)}`};
}

export function reserveWorkflowCall(job:Job,request:WorkflowLeadRequest):WorkflowCall|null {
  const f=job.workflow!,key=request.requestId;
  const same=f.calls.filter(c=>c.key===key);
  if(f.calls.some(c=>c.state==="started"||c.state==="pending"))throw new SociotechnicError("workflow-uncertain","A prior workflow call has no confirmed completion; its receipt must be reconciled before another launch");
  if(same.some(c=>c.state==="complete"))return null;
  const failed=f.calls.filter(c=>c.phase===request.phase&&c.state==="failed"&&c.round===job.round).length;
  if(failed>=1+effectiveCap(job,"retriesPerStep")){holdWorkflow(job,"Workflow response retry bound reached; inspect saved precise errors",new Date().toISOString());return null;}
  // Lead calls share the existing round dispatch budget rather than buying unlimited hidden work.
  const spent=job.dispatches.filter(d=>d.round===job.round).length+f.calls.filter(c=>c.round===job.round).length;
  if(spent>=effectiveCap(job,"dispatchesPerRound")){holdWorkflow(job,"Workflow calls reached the existing dispatches-per-round bound",new Date().toISOString());return null;}
  const id=`w-${f.calls.length+1}`,record=`workflow/calls/${id}.json`;
  const call:WorkflowCall={id,phase:request.phase,round:job.round,key,state:"pending",record};f.calls.push(call);
  writeJsonAtomic(path(job,record),{state:"pending",round:job.round,request});return call;
}
export function holdWorkflow(job:Job,reason:string,now:string):void {
  if(job.status!=="needs-human")park(job,reason,now);else job.statusReason=reason;
}
export function startWorkflowCall(job:Job,id:string):boolean {
  const call=job.workflow!.calls.find(c=>c.id===id)!;if(call.state!=="pending")throw new SociotechnicError("workflow-uncertain","Workflow call is no longer pending");
  if(workflowRequest(job,call.phase).requestId!==call.key){
    call.state="stale";const receipt=readJson(path(job,call.record)) as Record<string,unknown>;writeJsonAtomic(path(job,call.record),{...receipt,state:"stale",errors:["requestId: Context changed before launch; provider was not called"]});
    holdWorkflow(job,"Workflow context changed before launch; inspect retained receipt",new Date().toISOString());return false;
  }
  call.state="started";const receipt=readJson(path(job,call.record)) as Record<string,unknown>;writeJsonAtomic(path(job,call.record),{...receipt,state:"started",startedAt:new Date().toISOString()});return true;
}
export async function finishWorkflowCall(job:Job,id:string,request:WorkflowLeadRequest,execution:OrchestratorRun,now:string):Promise<boolean> {
  const f=job.workflow!,call=f.calls.find(c=>c.id===id);
  if(!call||call.key!==request.requestId||call.phase!==request.phase||!["pending","started"].includes(call.state))throw new SociotechnicError("workflow-stale","Completion does not match one unfinished workflow call; original receipt retained");
  let errors=validateWorkflowLeadReply(execution.response,request).map(e=>`${e.field}: ${e.message}`);
  if(execution.outcome!=="ok")errors.unshift(`provider.${execution.outcome}: ${execution.note??"no completion"}`);
  const stale=job.status==="stopped"||workflowRequest(job,request.phase).requestId!==request.requestId;
  if(stale)errors.unshift("requestId: Context changed while lead worked; response retained without applying");
  let selections:Record<string,AgentConfiguration>={};
  const reply=execution.response as WorkflowLeadReply;
  if(!errors.length&&reply.status==="ready")try{selections=await resolveWorkflowSelections(job,reply.selections,request.requiredSlots);}catch(e){errors.push(e instanceof Error?e.message:String(e));}
  call.state=stale?"stale":errors.length?"failed":"complete";
  writeJsonAtomic(path(job,call.record),{state:call.state,round:job.round,request,execution,errors,finishedAt:now});
  if(errors.length)return false;
  if(reply.status==="needs-input"){
    f.pending={requestId:request.requestId,phase:request.phase,questions:reply.questions,resumeStatus:job.status};
    f.conversation.push({requestId:request.requestId,questions:reply.questions});holdWorkflow(job,`Workflow lead requires input; ${call.record}`,now);return true;
  }
  if(request.phase==="intake"){
    const result=reply as WorkflowIntakeReply;f.selections={...f.selections,...selections};f.briefRecord="workflow/project-brief.md";
    writeTextAtomic(path(job,f.briefRecord),result.brief);f.phase="planning";
  }else if(request.phase==="assignment"){
    const result=reply as WorkflowAssignmentReply;f.selections={...f.selections,...selections};f.concurrency=result.concurrency;
    f.assignmentRecord="workflow/execution-assignment.json";f.assignmentDigest=sha({workflow:f.digest,lead:f.profile.digest,planner:f.selections["sociotechnic-planner"]??null,planDigest:job.plan!.digest,...result});writeJsonAtomic(path(job,f.assignmentRecord),{planDigest:job.plan!.digest,digest:f.assignmentDigest,...result});f.phase="approval";
  }else if(request.phase==="intent-review"){
    const result=reply as WorkflowIntentReply,approved=[...job.dispatches].reverse().find(d=>d.step==="approve"&&d.round===job.round&&d.outcome==="ok"&&d.parsed?.kind==="ok"&&d.parsed.effective==="APPROVE");
    const commit=approved?.parsed&&"commit" in approved.parsed?approved.parsed.commit:null;
    if(typeof commit!=="string")throw new IllegalTransition("Intent review requires an independently approved commit");
    f.intent={commit,round:job.round,status:result.status,record:call.record};f.phase="complete";
    if(result.status==="changes")holdWorkflow(job,`Workflow intent changes: ${result.findings.join("; ")}; ${call.record}`,now);
  }
  return true;
}
