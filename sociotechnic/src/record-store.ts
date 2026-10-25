import { AsyncLocalStorage } from "node:async_hooks";
import { join, relative, resolve, sep } from "node:path";
import { SociotechnicError } from "./errors.ts";
import type { Job } from "./job.ts";
import { jobDir } from "./paths.ts";
import { recordBytes, recordRow } from "./db/store.ts";
import type { RecordRow } from "./db/store.ts";

export type RecordSession = { job: Job | null; records: Map<string, RecordRow>; knownIds: Set<string>; reservation?: Job; commitGuards?: (() => Promise<void>)[] };
export const recordSession = new AsyncLocalStorage<RecordSession>();
export function session(): RecordSession {
  const value = recordSession.getStore();
  if (!value) throw new SociotechnicError("job-context-required", "Job operations must use the database operation boundary");
  return value;
}
function key(path: string): string {
  const job = session().job;
  if (!job) throw new SociotechnicError("not-found", "No job in this operation");
  const rel = relative(jobDir(job.id), resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new SociotechnicError("bad-record-path", "Record path escapes this job");
  return rel.split(sep).join("/");
}
export function validRecordPath(path: string): string {
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || path.split("/").some((p) => !p || p === "." || p === "..")) throw new SociotechnicError("bad-record-path", "Invalid relative record path");
  return path;
}
export function readBytes(path: string): Buffer {
  const record = session().records.get(key(path));
  if (!record) throw new SociotechnicError("not-found", `Missing record: ${key(path)}`);
  return recordBytes(record);
}
export function readText(path: string): string | null {
  const record = session().records.get(key(path));
  if (!record) return null;
  if (record.encoding === "base64") throw new SociotechnicError("bad-record", "Binary record cannot be read as text");
  return record.text;
}
export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) throw new SociotechnicError("not-found", `Missing record: ${key(path)}`);
  try { return JSON.parse(text); } catch { throw new SociotechnicError("bad-json", `Invalid JSON record: ${key(path)}`); }
}
export function writeBytes(path: string, bytes: Buffer): void { session().records.set(key(path), recordRow(key(path), bytes)); }
export function writeTextAtomic(path: string, text: string): void { writeBytes(path, Buffer.from(text)); }
export function writeJsonAtomic(path: string, value: unknown): void { writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`); }
export function hasRecord(path: string): boolean { return session().records.has(key(path)); }
export function recordNames(folder: string): string[] {
  const prefix = `${key(join(folder, ".directory" )).slice(0, -".directory".length)}`;
  return [...session().records.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length)).filter((path) => !path.includes("/")).sort();
}
export function retireRecord(path: string, target: string): void {
  const rel = key(path), record = session().records.get(rel);
  if (!record) return;
  session().records.set(key(target), { ...record, path: key(target) });
  session().records.delete(rel);
}
