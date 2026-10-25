import { SociotechnicError } from "./errors.ts";
import type { Job } from "./job.ts";

export const CONSOLE_HOLDABLE = ["planned", "built", "checked", "reviewed"] as const;
export type ConsoleHold = (typeof CONSOLE_HOLDABLE)[number];

export function isConsoleHold(value: unknown): value is ConsoleHold {
  return value === "planned" || value === "built" || value === "checked" || value === "reviewed";
}

export function parseConsoleHolds(value: unknown): ConsoleHold[] {
  if (!Array.isArray(value) || !value.every(isConsoleHold)) {
    throw new SociotechnicError("bad-input", "consoleHolds must be an array containing only planned, built, checked or reviewed");
  }
  return CONSOLE_HOLDABLE.filter((status) => value.includes(status));
}

export function initialConsoleHolds(holds: readonly ConsoleHold[] = []): ConsoleHold[] {
  return CONSOLE_HOLDABLE.filter((status) => status === "planned" || holds.includes(status));
}

export function continueConsoleHolds(job: Pick<Job, "status" | "consoleHolds">): ConsoleHold[] {
  if (job.consoleHolds === undefined) return ["new", "planning", "researching"].includes(job.status) ? ["planned"] : [];
  return initialConsoleHolds(job.consoleHolds).filter((status) => status !== job.status);
}
