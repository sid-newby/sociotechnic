import { hostname } from "node:os";
import { requireStore } from "./db/store.ts";
import type { JobLease } from "./db/store.ts";
import { SociotechnicError } from "./errors.ts";
export type DriverOwner = "ui" | "cli";
export type DriverLock = { pid: number; startedAt: string; mode: "run" | "step"; owner: DriverOwner; token?: string; host?: string; consoleUrl?: string };
const local = new Map<string, JobLease>();
const settledOwners = new Map<string,string>();
export function pidAlive(pid: number): boolean { try { process.kill(pid,0); return true; } catch { return false; } }
export async function driverState(id: string) { return requireStore().driver(id); }
export async function assertNoForeignDriver(id: string, callerPid: number): Promise<void> {
  const owner = await driverState(id);
  if (owner && (owner.pid !== callerPid || owner.host !== hostname() || !local.has(id))) throw new SociotechnicError("driver-active", `Job ${id} has an active or interrupted driver; reconcile ownership before continuing`);
}
export async function acquireDriver(id: string, lock: DriverLock, lost: () => void = () => undefined): Promise<string> {
  const store = requireStore(), lease = await store.lock(`driver:${id}`);
  let operation: JobLease | null = null;
  try {
    operation = await store.lock(`operation:${id}`);
    const job=await store.storedJob(id);
    if(job?.externalOperation)throw new SociotechnicError("reconcile-required", `Reconcile ${job.externalOperation.kind} before starting a driver`);
    const previous = await store.driver(id);
    if (previous && !(previous.host === hostname() && previous.pid === process.pid && settledOwners.get(id) === previous.token) && (previous.host !== hostname() || (typeof previous.pid === "number" && pidAlive(previous.pid)))) throw new SociotechnicError("driver-active", "Previous driver process must stop before takeover");
    local.set(id, lease);
    lease.signal.addEventListener("abort", lost, { once: true });
    await store.setDriver(id, { ...lock, host: hostname(), token: lease.token });
    return lease.token;
  } catch (error) { if(local.get(id) === lease) local.delete(id); await lease.release(); throw error; }
  finally { await operation?.release(); }
}
export async function releaseDriver(id: string, _pid: number): Promise<void> {
  const lease = local.get(id); if (!lease) return;
  try { if (!lease.signal.aborted && (await requireStore().driver(id))?.token === lease.token) await requireStore().setDriver(id,null); }
  finally { settledOwners.set(id,lease.token); local.delete(id); await lease.release(); }
}

export async function verifyDriverLease(id: string, token: string): Promise<void> {
  const lease = local.get(id);
  if(!lease || lease.token !== token || lease.signal.aborted) throw new SociotechnicError("ownership-lost", "Database driver ownership was lost");
  await lease.verify();
}
