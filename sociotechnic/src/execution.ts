import { SociotechnicError } from "./errors.ts";

export type DockerExecution = { kind: "docker-sandbox"; cpus: number; memoryGiB: number; parallelAgents: number };
export type Execution = { kind: "local" } | DockerExecution;

export function parseExecution(value: unknown): Execution {
  if (value === undefined) return { kind: "local" };
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SociotechnicError("bad-execution", "execution must be an object");
  if (!("kind" in value)) throw new SociotechnicError("bad-execution", "Choose local or docker-sandbox execution");
  if (value.kind === "local" && Object.keys(value).length === 1) return { kind: "local" };
  if (value.kind !== "docker-sandbox" || Object.keys(value).some((key) => !["kind", "cpus", "memoryGiB", "parallelAgents"].includes(key))) throw new SociotechnicError("bad-execution", "Unknown execution setting");
  const integer = (input: unknown, name: string, fallback: number, max: number): number => {
    const result = input === undefined ? fallback : input;
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1 || result > max) throw new SociotechnicError("bad-execution", `${name} must be an integer from 1 to ${max}`);
    return result;
  };
  return { kind: "docker-sandbox", cpus: integer("cpus" in value ? value.cpus : undefined, "cpus", 4, 32), memoryGiB: integer("memoryGiB" in value ? value.memoryGiB : undefined, "memoryGiB", 8, 64), parallelAgents: integer("parallelAgents" in value ? value.parallelAgents : undefined, "parallelAgents", 2, 4) };
}
