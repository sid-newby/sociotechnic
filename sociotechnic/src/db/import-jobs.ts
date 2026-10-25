import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../agent-version-data.ts";
import { validateJobAgentVersions } from "../agent-versions.ts";
import { SociotechnicError } from "../errors.ts";
import type { Job } from "../job.ts";
import { STATUSES } from "../job.ts";
import { jobsDir, stateDir, assertJobId } from "../paths.ts";
import { validRecordPath, recordSession } from "../record-store.ts";
import { parsePlanText } from "../plan.ts";
import { digest as evidenceDigest, INVENTORY_FILE } from "../comment-inventory.ts";
import { roleOf } from "../roles.ts";
import { parseRecord } from "../verdict.ts";
import { verifyDesign } from "../design.ts";
import { sociotechnicHome } from "../paths.ts";
import type { Store, RecordRow } from "./store.ts";
import { requireStore, recordRow, recordBytes } from "./store.ts";

const digest=(value: unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
export type ImportRecovery = { path: string; text: string; encoding?: "utf8" | "base64"; sha256: string; source: string };
export type ImportEntry={id:string;local:string|null;database:string|null;resolution:"local"|"database"|"unresolved";conflicts:string[];archive:string|null; recoveries?: ImportRecovery[]};
export type ImportManifest={schema:1;entries:ImportEntry[];digest:string};
export function parseJob(value: unknown): Job {
  if(typeof value!=="object"||value===null||!("id" in value)||!("status" in value)||typeof value.id!=="string"||!STATUSES.some((s)=>s===value.status)||!("repo" in value)||typeof value.repo!=="string"||!("dispatches" in value)||!Array.isArray(value.dispatches)||!("rounds" in value)||!Array.isArray(value.rounds))throw new SociotechnicError("bad-job","Invalid legacy job document");
  // Imported documents are additionally checked against their release bindings and evidence before commit.
  return value as Job;
}
function localSnapshot(id:string):{job:Job;records:RecordRow[]}|null {
  const root=join(jobsDir(),id),file=join(root,"job.json");if(!existsSync(file))return null;
  if(lstatSync(root).isSymbolicLink()||lstatSync(file).isSymbolicLink())throw new SociotechnicError("bad-import","Symlinked legacy job");
  const job=parseJob(JSON.parse(readFileSync(file,"utf8")));if(job.id!==id)throw new SociotechnicError("bad-import","Job folder and ID disagree");
  const archive=join(stateDir(),"console-archives",`${id}.json`);if(existsSync(archive))job.archived=true;
  const records:RecordRow[]=[];
  const walk=(dir:string):void=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,entry.name),path=relative(root,full).split(sep).join("/");
    if(entry.isSymbolicLink())throw new SociotechnicError("bad-import",`Symlinked legacy record ${id}/${path}`);
    if(entry.isDirectory())walk(full);
    else if(entry.isFile()){
      if(path==="job.json"||path==="job.lock"||path==="driver.json"||/\.tmp-\d+-[a-z0-9]+$/.test(path))continue;
      validRecordPath(path);const content=readFileSync(full);
      if(content.length>32*1024*1024)throw new SociotechnicError("bad-import",`Record exceeds explicit 32 MiB limit: ${id}/${path}`);
      records.push(recordRow(path,content,lstatSync(full).mtime.toISOString()));
    }else throw new SociotechnicError("bad-import",`Unsupported legacy artifact ${path}`);
  }};walk(root);return {job,records:records.sort((a,b)=>a.path.localeCompare(b.path))};
}
const contentDigest=(job:Job,records:RecordRow[])=>digest({job,records:records.map((r)=>({path:r.path,content:recordBytes(r).toString("base64")})).sort((a,b)=>a.path.localeCompare(b.path))});
function validateEvidence(job: Job, records: Map<string, RecordRow>): void {
  const requireText = (path: string): string => {
    const row=records.get(path);
    if(!row || row.encoding === "base64")throw new SociotechnicError("missing-evidence", `Missing referenced text evidence ${job.id}/${path}`);
    return row.text;
  };
  if(job.plan) {
    const plan=parsePlanText(requireText("plan.json"),job.research.done,job.design!==undefined);
    if(plan.kind!=="plan"||plan.digest!==job.plan.digest)throw new SociotechnicError("missing-evidence",`Pinned plan mismatch for ${job.id}`);
  }
  if(job.commentCleanup && evidenceDigest(requireText(INVENTORY_FILE))!==job.commentCleanup.inventoryDigest)throw new SociotechnicError("missing-evidence",`Comment inventory mismatch for ${job.id}`);
  for(const round of job.rounds) if(round.checks) {
    const report:unknown=JSON.parse(requireText(round.checks.path));
    if(typeof report!=="object"||report===null||!("commit" in report)||report.commit!==round.checks.commit||!("pass" in report)||report.pass!==round.checks.pass)throw new SociotechnicError("missing-evidence",`Checks evidence mismatch for ${job.id}`);
  }
  for(const [index,dispatch] of job.dispatches.entries()) if(dispatch.parsed?.kind==="ok") {
    const replacement=job.dispatches.slice(index+1).find((d)=>d.record===dispatch.record);
    const text=requireText(replacement?`${dispatch.record}.superseded-by-${replacement.id}`:dispatch.record);
    const role=roleOf(dispatch.configuration?.baseRole ?? dispatch.agent);
    if(role.record!=="plan" && role.record!=="design") {
      const parsed=parseRecord(text,role.record),saved=dispatch.parsed;
      if(parsed.kind!==saved.kind||parsed.effective!==saved.effective||parsed.commit!==saved.commit||canonicalJson(parsed.findings)!==canonicalJson(saved.findings))throw new SociotechnicError("contradictory-evidence",`Stored verdict contradicts ${job.id}/${dispatch.record}`);
    }
  }
}
export async function inventoryJobs(store:Store=requireStore(),preferLocal=false):Promise<ImportManifest>{
  const rows=await store.listJobs({}),ids=new Set(rows.map((r)=>r.id));
  if(existsSync(jobsDir()))for(const id of readdirSync(jobsDir()))if(existsSync(join(jobsDir(),id,"job.json")))ids.add(id);
  const entries:ImportEntry[]=[];
  for(const id of [...ids].sort()){
    const local=localSnapshot(id),db=await store.storedJob(id),records=db?await store.records(id):[];
    const conflicts:string[]=[];
    const duplicate=records.find((r)=>r.path==="job.json");
    if(duplicate){try{if(duplicate.encoding==="base64"||canonicalJson(JSON.parse(duplicate.text))!==canonicalJson(db))conflicts.push("database/job.json");}catch{conflicts.push("database/job.json");}}
    const archivePath=join(stateDir(),"console-archives",`${id}.json`);
    const archive=existsSync(archivePath)?createHash("sha256").update(readFileSync(archivePath)).digest("hex"):null;
    if(local&&db&&canonicalJson(local.job)!==canonicalJson(db))conflicts.push("job");
    const stored=new Map(records.map((r)=>[r.path,r]));
    if(local)for(const record of local.records){const old=stored.get(record.path);if(old&&!recordBytes(old).equals(recordBytes(record)))conflicts.push(record.path);}
    entries.push({id,archive,local:local?contentDigest(local.job,local.records):null,database:db?contentDigest(db,records):null,resolution:local?(conflicts.length&&!preferLocal?"unresolved":"local"):"database",conflicts});
  }
  return {schema:1,entries,digest:digest(entries)};
}
async function applyImport(manifest:ImportManifest,store:Store){
  if(!manifest||manifest.schema!==1||!Array.isArray(manifest.entries)||manifest.digest!==digest(manifest.entries))throw new SociotechnicError("bad-import","Import manifest integrity failed");
  for(const entry of manifest.entries){assertJobId(entry.id);if(!["local","database","unresolved"].includes(entry.resolution))throw new SociotechnicError("bad-import","Invalid source resolution");}
  if(new Set(manifest.entries.map((entry)=>entry.id)).size!==manifest.entries.length)throw new SociotechnicError("bad-import","Duplicate job IDs in import manifest");
  if(manifest.entries.some((entry)=>entry.resolution==="unresolved"))throw new SociotechnicError("import-conflict","Resolve all import conflicts in a reviewed manifest before applying");
  const ready=await store.migration("job-authority-v1");
  if(ready && typeof ready === "object" && "manifest" in ready && ready.manifest === manifest.digest) return {imported:0,already:true,digest:manifest.digest};
  if(ready)throw new SociotechnicError("import-complete","Legacy import is closed after database authority cutover");
  const current=await inventoryJobs(store);
  const expected=new Map(current.entries.map((e)=>[e.id,e]));
  const checkpoint = (id:string) => `import:${manifest.digest}:${id}`;
  if(expected.size!==manifest.entries.length)throw new SociotechnicError("stale-import","Job set changed since inventory");
  for(const entry of manifest.entries){const e=expected.get(entry.id);if(!e||e.local!==entry.local||e.archive!==entry.archive)throw new SociotechnicError("stale-import",`Source changed for ${entry.id}`);if(await store.migration(checkpoint(entry.id)))continue;if(e.database!==entry.database)throw new SociotechnicError("stale-import",`Source changed for ${entry.id}`);}
  for(const entry of manifest.entries){
    const completed = await store.migration(checkpoint(entry.id));
    if(completed){ const job=await store.storedJob(entry.id);if(!job||typeof completed!=="object"||!("after" in completed)||completed.after!==contentDigest(job,await store.records(entry.id)))throw new SociotechnicError("stale-import",`Completed import changed for ${entry.id}`);continue;}
    const lease=await store.lock(`operation:${entry.id}`);
    try{await store.transaction(async(tx)=>{
      const before=await tx.storedJob(entry.id),dbRecords=await tx.records(entry.id),local=localSnapshot(entry.id);
      if((before?contentDigest(before,dbRecords):null)!==entry.database||(local?contentDigest(local.job,local.records):null)!==entry.local)throw new SociotechnicError("stale-import",`Source changed for ${entry.id}`);
      const job=entry.resolution==="local"?local?.job:before;if(!job)throw new SociotechnicError("bad-import","Chosen job source missing");
      if(entry.archive!==null)job.archived=true;
      const selected=entry.resolution==="local"?local?.records ?? []:dbRecords.filter((r)=>r.path!=="job.json");
      const records=new Map(selected.map((r)=>[r.path,r]));
      const duplicate=dbRecords.find((r)=>r.path==="job.json");
      if(duplicate&&entry.conflicts.includes("database/job.json"))records.set("migration/database-job.json",{...duplicate,path:"migration/database-job.json"});
      for(const old of dbRecords)if(old.path!=="job.json"&&!records.has(old.path))records.set(`migration/database-only/${old.path}`,{...old,path:`migration/database-only/${old.path}`});
      for (const recovery of entry.recoveries ?? []) {
        validRecordPath(recovery.path);
        if(recovery.path === "job.json" || !recovery.source || !/^[a-f0-9]{64}$/.test(recovery.sha256))throw new SociotechnicError("bad-import","Invalid historical recovery entry");
        const content=Buffer.from(recovery.text,recovery.encoding === "base64" ? "base64" : "utf8");
        if(createHash("sha256").update(content).digest("hex")!==recovery.sha256)throw new SociotechnicError("bad-import","Historical recovery bytes do not match their digest");
        const old=records.get(recovery.path);
        if(old)records.set(`migration/unbound/${recovery.path}`,{...old,path:`migration/unbound/${recovery.path}`});
        records.set(recovery.path,recordRow(recovery.path,content,old?.mtime));
      }
      if(entry.recoveries?.length)records.set("migration/recovery-provenance.json",recordRow("migration/recovery-provenance.json",Buffer.from(JSON.stringify(entry.recoveries.map(({text:_bytes,...provenance})=>provenance),null,2)+"\n")));
      validateEvidence(job,records);
      await validateJobAgentVersions(tx,job,before);
      await recordSession.run({job,records,knownIds:new Set([job.id])},async()=>{if(job.design&&job.design.state!=="generating")verifyDesign(join(jobsDir(),job.id),job.design,sociotechnicHome());});
      await tx.upsertJob(job);await tx.linkAgentVersions(job.id,job.agentVersions??{},job.agentAssignments);
      for(const old of dbRecords)await tx.deleteRecord(job.id,old.path);
      for(const record of records.values())await tx.upsertRecord(job.id,record);
      await tx.insertEvents(job.id,[{at:new Date().toISOString(),kind:"sync",data:{operation:"import-jobs",manifest:manifest.digest,source:entry.resolution}}]);
      await tx.markMigration(checkpoint(entry.id),{after:contentDigest(job,[...records.values()])});
      await tx.notify(job.id);
    });}finally{await lease.release();}
  }
  await store.transaction((tx)=>tx.markMigration("job-authority-v1",{manifest:manifest.digest,jobs:manifest.entries.length}));
  return {imported:manifest.entries.length,digest:manifest.digest};
}

export async function importJobs(manifest: ImportManifest, store: Store = requireStore()) {
  const lease=await store.lock("operation:import-jobs");
  try { return await applyImport(manifest,store); } finally { await lease.release(); }
}
