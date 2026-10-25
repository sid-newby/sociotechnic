// Test-only deterministic fixture writes to an isolated PostgreSQL database.
import { requireStore, recordRow } from "../../src/db/store.ts";
import type { Job } from "../../src/job.ts";
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString()) as {op:string;id:string;job?:Job;path?:string;text?:string;value?:Record<string,unknown>|null};
const store=requireStore();
try{
 let result:unknown=null;
 if(input.op==="job")result=await store.storedJob(input.id);
 else if(input.op==="putJob"&&input.job)await store.transaction((tx)=>tx.upsertJob(input.job!));
 else if(input.op==="record")result=(await store.records(input.id)).find((r)=>r.path===input.path)?.text??null;
 else if(input.op==="putRecord"&&input.path)await store.transaction(async(tx)=>{await tx.upsertRecord(input.id,recordRow(input.path!,Buffer.from(input.text??"")));await tx.notify(input.id);});
 else if(input.op==="driver")await store.setDriver(input.id,input.value??null);
 else if(input.op==="getDriver")result=await store.driver(input.id);
 else if(input.op==="deleteRecord"&&input.path)await store.transaction((tx)=>tx.deleteRecord(input.id,input.path!));
 else throw Error("Unknown test fixture operation");
 process.stdout.write(JSON.stringify(result));
}finally{await store.close();}
