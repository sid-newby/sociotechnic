import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readerTools } from "../ui/codex-read-tools.ts";
import { scopedReadAllowed } from "../ui/runner.ts";
import { setStore } from "../src/db/store.ts";
import { loadAgentCatalog,listAgentVersions,pinAgentVersions,readAgentVersion } from "../src/agent-versions.ts";
import { roleOf } from "../src/roles.ts";
const root=mkdtempSync(join(tmpdir(),"sociotechnic-reader-boundaries-")),input=join(root,".sociotechnic/staging/job/dispatch/inputs"),backup=join(root,".sociotechnic/backups/old");
mkdirSync(input,{recursive:true});mkdirSync(backup,{recursive:true});mkdirSync(join(root,"src"));
writeFileSync(join(input,"plan.json"),"committed input");writeFileSync(join(backup,"job.json"),"retired truth");writeFileSync(join(root,"src/current.ts"),"current source");symlinkSync(backup,join(root,"old-link"));
after(()=>{setStore(undefined);rmSync(root,{recursive:true,force:true});});
test("Codex routine search excludes runtime state while assigned staging remains readable",()=>{
 const tools=readerTools([root,join(root,"src"),input]);
 assert.throws(()=>tools("read_file",{path:join(backup,"job.json")}),/outside.*roots/i);
 assert.throws(()=>tools("read_file",{path:join(root,"old-link/job.json")}),/outside.*roots/i);
 assert.match(tools("read_file",{path:join(input,"plan.json")}),/committed input/);
 const files=tools("glob",{path:root,pattern:"**/*"});assert(!files.includes("retired"));assert(!files.includes("backups"));assert.match(files,/current.ts/);
});
test("SDK read hooks reject retired state and broad runtime searches but allow source and assigned evidence",()=>{
 const context={cwd:root,home:root,inputs:input,outputs:join(root,".sociotechnic/staging/job/dispatch/outputs")};
 assert.equal(scopedReadAllowed({...context,tool:"Read",input:{file_path:join(backup,"job.json")}}),false);
 assert.equal(scopedReadAllowed({...context,tool:"Grep",input:{path:root}}),false);
 assert.equal(scopedReadAllowed({...context,tool:"Glob",input:{path:join(root,"src")}}),true);
 assert.equal(scopedReadAllowed({...context,tool:"Read",input:{file_path:join(input,"plan.json")}}),true);
});
test("disabled databases never substitute bundled agent releases for a runtime catalog",async()=>{
 setStore(null);const base=roleOf("sociotechnic-planner");
 await assert.rejects(readAgentVersion(base,"1.0.0"),/PostgreSQL/);await assert.rejects(listAgentVersions(base),/PostgreSQL/);await assert.rejects(pinAgentVersions(),/PostgreSQL/);await assert.rejects(loadAgentCatalog(),/PostgreSQL/);
});
