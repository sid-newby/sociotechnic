import { canonicalJson } from "./agent-version-data.ts";
import type { AgentCard } from "./agent-roster.ts";
import type { WorkflowResourceChoice } from "./workflow-selection.ts";

export type WorkflowLeadPhase = "intake" | "assignment" | "intent-review" | "exception";
export type WorkflowQuestion = { requestId: string; questions: string[]; answer?: string };
export type WorkflowEvidence = { record: string; text: string; encoding?: "base64"; sha256: string };
export type WorkflowLeadRequest = {
  schemaVersion: 1; requestId: string; phase: WorkflowLeadPhase;
  job: { id: string; originalIntent: string; repo: string; worktree: string; branch: string };
  workflow: { name: string; digest: string };
  context?: {round:number;status:string;reason:string;caps:unknown;overrides:unknown};
  brief: string | null; plan: unknown; planDigest: string | null;
  resources: AgentCard[]; lockedSlots: string[]; currentSelections: WorkflowResourceChoice[];
  requiredSlots: string[]; nodeLimits: Record<string,number>;
  conversation: WorkflowQuestion[]; evidence: WorkflowEvidence[];
};
export type WorkflowNeedsInput = { status: "needs-input"; questions: string[] };
export type WorkflowIntakeReply = { status: "ready"; brief: string; selections: WorkflowResourceChoice[] };
export type WorkflowAssignmentReply = { status: "ready"; selections: WorkflowResourceChoice[]; concurrency: Record<string,number>; reason: string };
export type WorkflowIntentReply = { status: "aligned" | "changes"; summary: string; findings: string[] };
export type WorkflowLeadReply = WorkflowNeedsInput | WorkflowIntakeReply | WorkflowAssignmentReply | WorkflowIntentReply;
export type WorkflowLeadError = { field: string; message: string };

export function validateWorkflowLeadReply(raw: unknown, request: WorkflowLeadRequest): WorkflowLeadError[] {
  const errors: WorkflowLeadError[]=[];
  const error=(field:string,message:string)=>errors.push({field,message});
  const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
  if(!object(raw))return [{field:"reply",message:"Expected a JSON response object"}];
  const exact=(fields:string[])=>{
    for(const field of fields)if(!Object.hasOwn(raw,field))error(field,"Required field is absent");
    for(const field of Object.keys(raw))if(!fields.includes(field))error(field,"Unexpected field; do not introduce execution permissions or instructions");
  };
  const text=(value:unknown,max=16000)=>typeof value==="string"&&!!value.trim()&&value.length<=max;
  if(raw.status==="needs-input"){
    exact(["status","questions"]);
    if(!Array.isArray(raw.questions)||!raw.questions.length||raw.questions.length>6||raw.questions.some(q=>!text(q,4000)))error("questions","Ask one to six concrete questions of at most4000 characters");
    return errors;
  }
  if(request.phase==="exception")return [{field:"status",message:"A blocked execution requires needs-input with concrete questions; a lead cannot waive the engine gate"}];
  if(request.phase==="intent-review"){
    exact(["status","summary","findings"]);
    if(raw.status!=="aligned"&&raw.status!=="changes")error("status","Expected aligned or changes");
    if(!text(raw.summary))error("summary","State how the result meets or misses the original request");
    if(!Array.isArray(raw.findings)||raw.findings.some(f=>!text(f,4000)))error("findings","Findings must be explicit nonempty strings");
    else if(raw.status==="changes"&&!raw.findings.length)error("findings","Name the concrete intent mismatch");
    else if(raw.status==="aligned"&&raw.findings.length)error("findings","Unresolved intent findings cannot claim alignment");
    return errors;
  }
  exact(request.phase==="intake"?["status","brief","selections"]:["status","selections","concurrency","reason"]);
  if(raw.status!=="ready")error("status","Expected ready or needs-input");
  if(request.phase==="intake"&&!text(raw.brief))error("brief","Provide a concise factual project brief for the planner");
  if(!Array.isArray(raw.selections))error("selections","Choose the exact required role slots from the frozen allowed catalog");
  else {
    const choices=raw.selections;
    if(choices.some(choice=>!object(choice)||!text(choice.slot)||!text(choice.agent)||!text(choice.version)||Object.keys(choice).sort().join()!==["slot","agent","version"].sort().join()))error("selections","Each selection contains only slot, agent and version");
    else if(canonicalJson(choices.map(choice=>(choice as WorkflowResourceChoice).slot).sort())!==canonicalJson([...request.requiredSlots].sort()))error("selections","Select every required role slot exactly once, with no additional slots");
  }
  if(request.phase==="assignment"){
    if(!text(raw.reason))error("reason","Explain the assignment and useful parallelism briefly");
    if(!object(raw.concurrency))error("concurrency","Return the provided node IDs with their chosen concurrency");
    else {
      if(canonicalJson(Object.keys(raw.concurrency).sort())!==canonicalJson(Object.keys(request.nodeLimits).sort()))error("concurrency","Return exactly the provided node IDs");
      for(const [node,value] of Object.entries(raw.concurrency))if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1||value>(request.nodeLimits[node]??0))error(`concurrency.${node}`,"Concurrency must be positive and no greater than the supplied node ceiling");
    }
  }
  return errors;
}
