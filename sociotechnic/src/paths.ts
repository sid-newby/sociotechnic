import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SociotechnicError } from "./errors.ts";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const JOB_ID = /^[0-9]{8}-[a-z0-9][a-z0-9-]*$/;

export function sociotechnicHome(): string {
  const env = process.env.SOCIOTECHNIC_HOME;
  return env !== undefined && env.length > 0 ? resolve(env) : resolve(SRC_DIR, "..", "..");
}

export function stateDir(): string {
  return join(sociotechnicHome(), ".sociotechnic");
}

export function jobsDir(): string {
  return join(stateDir(), "jobs");
}

export function worktreesDir(): string {
  return join(stateDir(), "worktrees");
}

export function assertJobId(id: string): string {
  if (!JOB_ID.test(id)) throw new SociotechnicError("bad-job-id", `not a job id: ${id}`);
  return id;
}

export function jobDir(id: string): string {
  return join(jobsDir(), assertJobId(id));
}

export function roundDirName(n: number): string {
  return `round-${n}`;
}
