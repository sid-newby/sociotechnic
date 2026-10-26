import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { canonicalJson } from "./agent-version-data.ts";
import type { DispatchOut } from "./engine.ts";
import { verifyDriverLease } from "./driverlock.ts";
import { finish, interrupt } from "./engine.ts";
import { SociotechnicError } from "./errors.ts";
import type { Outcome } from "./job.ts";
import { mutateJob, readJob } from "./job-store.ts";
import { jobDir, stateDir } from "./paths.ts";
import { session, validRecordPath } from "./record-store.ts";
import { recordBytes, recordRow, requireStore } from "./db/store.ts";
import { PLAN_CONTRACT_RECORD } from "./plan.ts";
import { RECIPIENT_CONTRACT_FILE } from "./recipient-contract.ts";
import { createHandoff, handoffInputRecords, handoffJobSnapshot } from "./handoff.ts";
import type { Handoff } from "./handoff.ts";
import { HANDOFF_RECORD, HandoffValidationError, handoffInput } from "./handoff-routing.ts";

export type StagedDispatch = { entry: DispatchOut; root: string; inputs: string; outputs: string; manifest: Record<string,string>; token: string };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function stagingRoot(job: string, dispatch: string): string {
  if (!/^d-[a-zA-Z0-9-]+$/.test(dispatch)) throw new SociotechnicError("bad-dispatch", "Invalid dispatch ID");
  return join(stateDir(), "staging", job, dispatch);
}
function put(root: string, path: string, bytes: Buffer): void {
  validRecordPath(path); const target = join(root,path);
  mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,bytes);
}
function files(root: string): string[] {
  const result: string[] = [];
  const walk = (folder: string): void => {
    if (lstatSync(folder).isSymbolicLink()) throw new SociotechnicError("bad-output", "Symlinked staging directory");
    for (const file of readdirSync(folder,{withFileTypes:true})) {
      const path = join(folder,file.name);
      if (file.isSymbolicLink()) throw new SociotechnicError("bad-output", "Symlinked staged output");
      if (file.isDirectory()) walk(path);
      else if (file.isFile()) result.push(relative(root,path).split(sep).join("/"));
      else throw new SociotechnicError("bad-output", "Output is not a regular file");
    }
  };
  walk(root); return result.sort();
}
export async function prepareDispatch(id: string, envelope: DispatchOut, token: string): Promise<StagedDispatch> {
  await verifyDriverLease(id,token);
  const root=stagingRoot(id,envelope.id), inputs=join(root,"inputs"),outputs=join(root,"outputs");
  if (existsSync(root)) throw new SociotechnicError("staging-exists", "Previous dispatch staging requires explicit recovery before relaunch");
  const manifest: Record<string,string> = {};
  let handoff: Handoff | undefined;
  await readJob(id,(job)=>{
    const pending = job.dispatches.find((d)=>d.id===envelope.id);
    if (!pending || pending.finishedAt || pending.execution?.launch !== "pending") throw new SociotechnicError("dispatch-claimed", "Dispatch has already been claimed or finished");
    const contracts = ["contracts/handoff.schema.json", "contracts/handoff.example.json", ...(envelope.record === "plan.json" ? [PLAN_CONTRACT_RECORD] : job.orchestrator?.contractVersion === 1 ? [`contracts/${RECIPIENT_CONTRACT_FILE}`] : [])];
    for (const path of [...contracts, HANDOFF_RECORD]) if (session().records.has(path)) throw new HandoffValidationError(envelope, [{ field: `artifacts.${path}`, code: "reserved-input", message: "Canonical record conflicts with an engine-owned contract path", owner: "driver" }]);
    mkdirSync(inputs,{recursive:true}); mkdirSync(outputs,{recursive:true});
    mkdirSync(dirname(join(outputs,envelope.record)),{recursive:true});
    const selected = job.orchestrator?.contractVersion === 1 ? handoffInputRecords(handoffInput(job,envelope,session().records)) : null;
    if (selected?.issues.length) throw new HandoffValidationError(envelope,selected.issues);
    for(const [path,row] of session().records) { if(path.startsWith("migration/") || path.startsWith("handoff/archive/") || path.startsWith("orchestrator/") || (selected && !selected.records.includes(path))) continue; const bytes=recordBytes(row); put(inputs,path,bytes); manifest[path]=hash(bytes); }
    const bytes=Buffer.from(JSON.stringify(handoffJobSnapshot(job,envelope),null,2)+"\n");put(inputs,"job.json",bytes);manifest["job.json"]=hash(bytes);
    for (const path of contracts) {
      let content: Buffer;
      try { content = readFileSync(new URL(`../schemas/${path.slice("contracts/".length)}`, import.meta.url)); }
      catch(error) { throw new HandoffValidationError(envelope,[{field:`contracts.${path}`,code:"contract-unavailable",message:"Engine-owned contract is unavailable",owner:"driver",evidence:String(error)}]); }
      put(inputs,path,content);manifest[path]=hash(content);
    }
    const checked = createHandoff(handoffInput(job,envelope,session().records));
    if (!checked.ok) throw new HandoffValidationError(envelope,checked.issues);
    handoff = checked.handoff;
    const content = Buffer.from(JSON.stringify(handoff,null,2)+"\n");put(inputs,HANDOFF_RECORD,content);manifest[HANDOFF_RECORD]=hash(content);
  });
  const verifiedHandoff = handoff;
  if (!verifiedHandoff) throw new HandoffValidationError(envelope,[{field:"handoff",code:"missing-handoff",message:"Handoff construction did not complete",owner:"driver"}]);
  const canonical=jobDir(id);
  const outputPaths=[envelope.record];
  if(envelope.record==="plan.json") outputPaths.push("plan.md");
  if(envelope.record==="decision.md") outputPaths.push("pr-notes.md");
  let prompt=envelope.prompt;
  for(const path of outputPaths) prompt=prompt.replaceAll(join(canonical,path),join(outputs,path));
  if(envelope.designScope) {
    const rel=relative(canonical,envelope.designScope.artifacts);
    prompt=prompt.replaceAll(envelope.designScope.artifacts,join(outputs,rel));
    for(const name of ["PRODUCT.md","DESIGN.md"]) if(existsSync(join(inputs,rel,name))) put(outputs,join(rel,name),readFileSync(join(inputs,rel,name)));
  }
  prompt=prompt.replaceAll(canonical,inputs);
  prompt += `\n\nHandoff: ${join(inputs,HANDOFF_RECORD)}. This is the engine-owned workspace, artifact, delivery and limit contract. Schema/example references: ${join(inputs,"contracts/handoff.schema.json")} and ${join(inputs,"contracts/handoff.example.json")}; read them only if needed. Missing required data or unavailable paths must be reported through the existing escalation path, never guessed.\n`;
  prompt += `\n\nStorage adapter: PostgreSQL owns committed job records. Read the staged inputs at ${inputs}. Write only assigned outputs under ${outputs}. Do not edit inputs. Legacy instruction paths refer to this staging scope; no .sociotechnic/jobs directory is authoritative.\n`;
  const entry: DispatchOut={...envelope,prompt, ...(envelope.designScope ? {designScope:{...envelope.designScope,record:join(outputs,envelope.record),artifacts:join(outputs,relative(canonical,envelope.designScope.artifacts)),receipt:join(outputs,relative(canonical,envelope.designScope.receipt))}} : {})};
  mkdirSync(dirname(join(outputs,envelope.record)),{recursive:true});
  await mutateJob(id,async(job)=>{
    (session().commitGuards ??= []).push(()=>verifyDriverLease(id,token));
    await verifyDriverLease(id,token);
    if((await requireStore().driver(id))?.token!==token)throw new SociotechnicError("ownership-lost","Driver no longer owns this dispatch");
    const d=job.dispatches.find((d)=>d.id===entry.id);
    if(!d?.execution || d.execution.launch!=="pending")throw new SociotechnicError("dispatch-claimed","Dispatch already claimed");
    const handoffRecord=`handoff/archive/${entry.id}.json`;
    session().records.set(handoffRecord,recordRow(handoffRecord,Buffer.from(JSON.stringify({schemaVersion:1,handoff:verifiedHandoff,manifest,envelope:entry,transport:"host-staged; sandbox adapter rewrites mapped paths before guest delivery"},null,2)+"\n")));
    d.execution={...d.execution,launch:"claimed",owner:token,inputDigest:hash(canonicalJson(manifest)),handoffRecord};
  });
  return {entry,root,inputs,outputs,manifest,token};
}
function allowed(path: string, entry: DispatchOut): boolean {
  if(path===entry.record)return true;
  if(entry.record==="plan.json" && path==="plan.md")return true;
  if(entry.record==="decision.md" && path==="pr-notes.md")return true;
  const design=/^design\/round-([1-9][0-9]*)\.json$/.exec(entry.record);
  if(design && (path===`design/tool-${design[1]}.json` || path.startsWith(`design/atelier/round-${design[1]}/`)))return true;
  const build=/^round-([1-9][0-9]*)\/build\.md$/.exec(entry.record);
  return Boolean(build && (path.startsWith(`round-${build[1]}/workers/`) || path===`round-${build[1]}/comment-coverage.md`));
}
export async function ingestDispatch(id: string, stage: StagedDispatch, result: {outcome: Outcome;usage:unknown;note:string|null}) {
  const output=files(stage.outputs);
  for(const path of files(stage.inputs)) {
    if(stage.manifest[path]!==hash(readFileSync(join(stage.inputs,path)))) throw new SociotechnicError("input-changed",`Staged input changed: ${path}`);
  }
  if(files(stage.inputs).length!==Object.keys(stage.manifest).length)throw new SociotechnicError("input-changed","Staged inputs disappeared");
  let bytes=0;
  const records=output.map((path)=>{
    if(!allowed(path,stage.entry))throw new SociotechnicError("bad-output",`Undeclared output: ${path}`);
    const content=readFileSync(join(stage.outputs,path));bytes+=content.length;
    if(content.length>32*1024*1024 || bytes>128*1024*1024)throw new SociotechnicError("output-too-large","Dispatch output exceeds explicit storage limit");
    return recordRow(path,content);
  });
  const digest=hash(canonicalJson({result,records:records.map((r)=>({path:r.path,hash:hash(recordBytes(r))}))}));
  const out=await mutateJob(id,async(job)=>{
    const d=job.dispatches.find((d)=>d.id===stage.entry.id);
    if(!d?.execution)throw new SociotechnicError("not-found","Dispatch missing its execution request");
    if(d.finishedAt) {
      if(d.execution.completionDigest!==digest)throw new SociotechnicError("completion-conflict","Dispatch already completed with different output");
      return {dispatch:d.id,outcome:d.outcome,parsed:d.parsed};
    }
    (session().commitGuards ??= []).push(()=>verifyDriverLease(id,stage.token));
    await verifyDriverLease(id,stage.token);
    if((await requireStore().driver(id))?.token!==stage.token || d.execution.owner!==stage.token)throw new SociotechnicError("ownership-lost","Stale driver completion rejected");
    if(d.execution.inputDigest!==hash(canonicalJson(stage.manifest)))throw new SociotechnicError("input-changed","Input manifest mismatch");
    for(const record of records)session().records.set(record.path,record);
    const out=result.outcome==="interrupted"?interrupt(job,d.id,result.note,result.usage):finish(job,d.id,result.outcome,result.usage,result.note);
    d.execution={...d.execution,launch:"finished",completionDigest:digest};
    return out;
  });
  rmSync(stage.root,{recursive:true,force:true});return out;
}
export function stagedRecord(stage: StagedDispatch): string { return resolve(stage.outputs,stage.entry.record); }
