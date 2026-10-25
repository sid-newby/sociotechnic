import { useEffect, useRef, useState } from "react";
import { parseExecution } from "../../../src/execution.ts";
import type { DockerExecution, Execution } from "../../../src/execution.ts";
import { object } from "./model";

const STORAGE_KEY = "sociotechnic.new-run-environment.v1";
const STORAGE_NOTICE = "Browser storage is unavailable. Your run environment settings will not be remembered across sessions.";
const DEFAULTS: { kind: Execution["kind"]; sandbox: DockerExecution; notice: string } = {
  kind: "local", sandbox: { kind: "docker-sandbox", cpus: 4, memoryGiB: 8, parallelAgents: 2 }, notice: "",
};

function savedEnvironment(): typeof DEFAULTS {
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { return { ...DEFAULTS, notice: STORAGE_NOTICE }; }
  if (raw === null) return DEFAULTS;
  try {
    const value = object(JSON.parse(raw));
    const sandbox = parseExecution(value.sandbox);
    if ((value.kind === "local" || value.kind === "docker-sandbox") && sandbox.kind === "docker-sandbox") return { kind: value.kind, sandbox, notice: "" };
  } catch { /* Malformed preferences use the normal new-run defaults. */ }
  return DEFAULTS;
}

export function useRunEnvironment() {
  const [saved] = useState(savedEnvironment);
  const [executionKind, setExecutionKind] = useState(saved.kind);
  const [cpus, setCpus] = useState(String(saved.sandbox.cpus));
  const [memoryGiB, setMemoryGiB] = useState(String(saved.sandbox.memoryGiB));
  const [parallelAgents, setParallelAgents] = useState(String(saved.sandbox.parallelAgents));
  const [notice, setNotice] = useState(saved.notice);
  const validSandbox = useRef(saved.sandbox);

  useEffect(() => {
    try {
      const sandbox = parseExecution({ kind: "docker-sandbox", cpus: Number(cpus), memoryGiB: Number(memoryGiB), parallelAgents: Number(parallelAgents) });
      if (sandbox.kind === "docker-sandbox") validSandbox.current = sandbox;
    } catch { /* Keep the last valid resources while a field is being edited. */ }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: executionKind, sandbox: validSandbox.current }));
      setNotice("");
    } catch { setNotice(STORAGE_NOTICE); }
  }, [executionKind, cpus, memoryGiB, parallelAgents]);

  return { executionKind, setExecutionKind, cpus, setCpus, memoryGiB, setMemoryGiB, parallelAgents, setParallelAgents, notice };
}
