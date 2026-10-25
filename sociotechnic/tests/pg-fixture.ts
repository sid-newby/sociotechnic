import { configuredTestDatabaseUrl } from "./fixtures/postgres-environment.ts";
import { after } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectClient, createPgStore } from "../src/db/store.ts";
import { schemaSql } from "../src/db/init.ts";
import { initializeAgentVersions } from "../src/agent-versions.ts";

export async function testDatabase(suffix: string): Promise<string | null> {
  const raw=configuredTestDatabaseUrl(process.env.SOCIOTECHNIC_TEST_DATABASE_URL);
  if(!raw)return null;
  const server=new URL(raw);server.pathname="/postgres";
  const name=`sociotechnic_test_${process.pid}_${suffix}`;
  const admin=await connectClient(server.toString());
  try{await admin.query(`create database "${name}"`);}finally{await admin.end();}
  const target=new URL(raw);target.pathname=`/${name}`;
  const url=target.toString(),store=createPgStore(url);
  try{await store.exec(schemaSql());await initializeAgentVersions(store,[],[]);await store.transaction((tx)=>tx.markMigration("job-authority-v1",{fixture:true}));}finally{await store.close();}
  after(async()=>{const c=await connectClient(server.toString());try{await c.query(`drop database "${name}" with (force)`);}finally{await c.end();}});
  return url;
}
export function databaseFixture<T=unknown>(url: string, operation: Record<string,unknown>): T {
  return JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL("./fixtures/database-fixture.ts",import.meta.url))],{env:{...process.env,SOCIOTECHNIC_DATABASE_URL:url},input:JSON.stringify(operation),encoding:"utf8"}));
}
