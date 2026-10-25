import { hostname } from "node:os";
import { driverState, pidAlive } from "../src/driverlock.ts";
import { owningConsoleUrl } from "../src/driver-location.ts";
import type { DriverOwnership } from "../src/driver-location.ts";
import type { DriverRegistry, DriverState } from "./driver.ts";

export type ConsoleDriverState = DriverState & { ownership: DriverOwnership };

async function legacyConsole(id: string, owner: Record<string, unknown>, currentUrl: string): Promise<string | null> {
  if (typeof owner.pid !== "number" || typeof owner.startedAt !== "string") return null;
  const found = await Promise.all([4747, 4748].map(async (port) => {
    const base = `http://127.0.0.1:${port}/`;
    if (new URL(currentUrl).port === String(port)) return null;
    try {
      const health: unknown = await (await fetch(`${base}api/health`, { signal: AbortSignal.timeout(500), redirect: "error" })).json();
      if (!health || typeof health !== "object" || !("pid" in health) || health.pid !== owner.pid) return null;
      const driver: unknown = await (await fetch(`${base}api/jobs/${encodeURIComponent(id)}/driver`, { signal: AbortSignal.timeout(500), redirect: "error" })).json();
      return driver && typeof driver === "object" && "running" in driver && driver.running === true && "startedAt" in driver && driver.startedAt === owner.startedAt ? owningConsoleUrl(base, id) : null;
    } catch { return null; }
  }));
  return found.find((url) => url !== null) ?? null;
}

export async function consoleDriverState(drivers: DriverRegistry, id: string, currentUrl: string): Promise<ConsoleDriverState> {
  const local = drivers.state(id);
  if (local.running) return { ...local, ownership: { kind: "local" } };
  const owner = await driverState(id);
  if (!owner) return { ...local, ownership: { kind: "none" } };
  const sameHost = owner.host === hostname();
  if (sameHost && typeof owner.pid === "number" && !pidAlive(owner.pid)) return { ...local, ownership: { kind: "interrupted" } };
  const kind = owner.owner === "ui" || owner.owner === "cli" ? owner.owner : "unknown";
  const url = sameHost && kind === "ui" ? owningConsoleUrl(owner.consoleUrl, id) ?? (owner.consoleUrl === undefined ? await legacyConsole(id, owner, currentUrl) : null) : null;
  return {
    running: true, mode: owner.mode === "run" || owner.mode === "step" ? owner.mode : null,
    startedAt: typeof owner.startedAt === "string" ? owner.startedAt : null,
    hold: [], finishedAt: null, active: [], queued: [], log: [], lastStep: null, error: null,
    ownership: { kind: "external", owner: kind, url },
  };
}
