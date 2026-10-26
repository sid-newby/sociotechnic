import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SociotechnicError } from "./errors.ts";

export type WorkflowAgent = "lead" | "selected.planner" | "selected.builder" | "selected.reviewers" | "selected.approver" | "selected.designer";
export type WorkflowMechanical = "canonical-checks" | "commit-and-evidence-gate";
export type WorkflowHuman = "approve-plan-and-assignment" | "accept-result";
type Ports = { in: Record<string, { from: string; contract: string }>; out: Record<string, string>; concurrency: number; next: string; repair?: { to: string; bound: "run.caps.rounds" } };
export type WorkflowNode = Ports & (
  | { agent: WorkflowAgent; mechanical?: never; human?: never }
  | { mechanical: WorkflowMechanical; agent?: never; human?: never }
  | { human: WorkflowHuman; agent?: never; mechanical?: never }
);
export type WorkflowDefinition = {
  version: 1; name: string; entry: string; lead: "selected.orchestrator";
  resources: { catalog: "run.allowedCatalog"; tools: "run.allowedTools"; limits: "run.limits"; prefer?: string };
  retry: { to: "self"; bound: "run.caps.retriesPerStep" };
  escalate: { owner: "lead"; fallback: "human" };
  contracts: Record<string, string>; nodes: Record<string, WorkflowNode>;
};

const AGENTS = ["lead", "selected.planner", "selected.builder", "selected.reviewers", "selected.approver", "selected.designer"];
const MECHANICAL = ["canonical-checks", "commit-and-evidence-gate"];
const HUMAN = ["approve-plan-and-assignment", "accept-result"];
const CONTRACTS = new Set([
  "engine:job-intent@1", "engine:project-brief@1", "engine:execution-assignment@1", "engine:intent-review@1", "engine:human-approval@1",
  "sociotechnic/schemas/plan.schema.json#/$defs/plan", "sociotechnic/schemas/recipient-contract.v1.json#/$defs/build",
  "sociotechnic/schemas/recipient-contract.v1.json#/$defs/decision", "engine:checks-report@1", "engine:review-bundle@1", "engine:quality-gate@1",
]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
function invalid(path: string, reason: string): never { throw new SociotechnicError("workflow-invalid", `${path}: ${reason}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "expected a mapping");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, path: string, allowed: readonly string[], required: readonly string[] = allowed): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${path}.${key}`, "unknown field");
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, "required");
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) invalid(path, "expected a nonempty string of at most 512 characters");
  return value;
}
function choice(value: unknown, path: string, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(path, `expected ${allowed.join(" | ")}`);
}
function identifier(value: unknown, path: string): string {
  const result = text(value, path); if (!ID.test(result)) invalid(path, "expected a lowercase identifier"); return result;
}

// The editable surface is block mappings and string/integer scalars, not general YAML execution.
function blockYaml(source: string): unknown {
  if (Buffer.byteLength(source) > 65_536) invalid("workflow", "document exceeds 64 KiB");
  const root: Record<string, unknown> = Object.create(null);
  const stack = [{ indent: -2, value: root, path: "workflow" }];
  function content(line: string, n: number): string {
    let quote = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote === '"' && c === "\\") { i++; continue; }
      if (quote === "'" && c === "'" && line[i + 1] === "'") { i++; continue; }
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
    }
    if (quote) invalid(`line ${n}`, "unterminated quoted scalar");
    return line.trimEnd();
  }
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const n = index + 1;
    if (original.includes("\t")) invalid(`line ${n}`, "tabs are unsupported; use two-space indentation");
    const line = content(original, n); if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (indent !== parent.indent + 2 || indent > 20) invalid(`line ${n}`, "expected two-space mapping indentation");
    const match = /^([a-z][a-z0-9-]*):(?: +(.*)|$)/.exec(line.trimStart());
    if (!match) invalid(`line ${n}`, "expected key: value; sequences, flow collections, tags, aliases and multiple documents are unsupported");
    const [, key, raw] = match, path = `${parent.path}.${key}`;
    if (Object.hasOwn(parent.value, key)) invalid(path, `duplicate key at line ${n}`);
    if (raw === undefined || raw === "") {
      const value: Record<string, unknown> = Object.create(null); parent.value[key] = value;
      stack.push({ indent, value, path }); continue;
    }
    let value: string | number;
    if (raw.startsWith('"')) {
      try { value = JSON.parse(raw); } catch { invalid(path, `invalid quoted string at line ${n}`); }
      if (typeof value !== "string") invalid(path, "expected a string scalar");
    } else if (raw.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(raw)) invalid(path, "invalid single-quoted string");
      value = raw.slice(1, -1).replace(/''/g, "'");
    } else if (/^(0|[1-9][0-9]*)$/.test(raw)) {
      value = Number(raw); if (!Number.isSafeInteger(value)) invalid(path, "integer exceeds safe range");
    } else {
      if (/^[\[\]{}&*!>|%@`?,-]/.test(raw) || /:\s/.test(raw) || /^(true|false|null|~)$/i.test(raw)) invalid(path, "unsupported YAML scalar; quote strings, use integers for limits");
      value = raw;
    }
    parent.value[key] = value;
  }
  return root;
}

export function parseWorkflowYaml(source: string): WorkflowDefinition {
  const value = object(blockYaml(source), "workflow");
  keys(value, "workflow", ["version", "name", "entry", "lead", "resources", "retry", "escalate", "contracts", "nodes"]);
  if (value.version !== 1) invalid("workflow.version", "expected 1");
  identifier(value.name, "workflow.name"); identifier(value.entry, "workflow.entry");
  choice(value.lead, "workflow.lead", ["selected.orchestrator"]);
  const resources = object(value.resources, "workflow.resources");
  keys(resources, "workflow.resources", ["catalog", "tools", "limits", "prefer"], ["catalog", "tools", "limits"]);
  for (const [key, expected] of Object.entries({ catalog: "run.allowedCatalog", tools: "run.allowedTools", limits: "run.limits" })) choice(resources[key], `workflow.resources.${key}`, [expected]);
  if (resources.prefer !== undefined) text(resources.prefer, "workflow.resources.prefer");
  const retry = object(value.retry, "workflow.retry"); keys(retry, "workflow.retry", ["to", "bound"]);
  choice(retry.to, "workflow.retry.to", ["self"]); choice(retry.bound, "workflow.retry.bound", ["run.caps.retriesPerStep"]);
  const escalate = object(value.escalate, "workflow.escalate"); keys(escalate, "workflow.escalate", ["owner", "fallback"]);
  choice(escalate.owner, "workflow.escalate.owner", ["lead"]); choice(escalate.fallback, "workflow.escalate.fallback", ["human"]);
  const contracts = object(value.contracts, "workflow.contracts");
  if (!Object.keys(contracts).length) invalid("workflow.contracts", "at least one contract is required");
  for (const [name, ref] of Object.entries(contracts)) { identifier(name, `workflow.contracts.${name}`); if (!CONTRACTS.has(text(ref, `workflow.contracts.${name}`))) invalid(`workflow.contracts.${name}`, "unknown contract reference"); }
  const nodes = object(value.nodes, "workflow.nodes"), ids = Object.keys(nodes);
  if (ids.length < 1 || ids.length > 32) invalid("workflow.nodes", "expected 1..32 nodes");
  for (const [name, raw] of Object.entries(nodes)) {
    const path = `workflow.nodes.${name}`, node = object(raw, path); identifier(name, path);
    if (name === "done") invalid(path, "done is reserved for completion");
    keys(node, path, ["agent", "mechanical", "human", "in", "out", "concurrency", "next", "repair"], ["in", "out", "concurrency", "next"]);
    const owners = ["agent", "mechanical", "human"].filter(key => Object.hasOwn(node, key));
    if (owners.length !== 1) invalid(path, "exactly one agent, mechanical or human owner is required");
    const owner = owners[0]; choice(node[owner], `${path}.${owner}`, owner === "agent" ? AGENTS : owner === "mechanical" ? MECHANICAL : HUMAN);
    if (typeof node.concurrency !== "number" || !Number.isInteger(node.concurrency) || node.concurrency < 1 || node.concurrency > 16) invalid(`${path}.concurrency`, "expected an integer ceiling from 1 to 16");
    if (node.agent !== "selected.reviewers" && node.concurrency !== 1) invalid(`${path}.concurrency`, "only independent reviewers may have more than one concurrent owner");
    const next = identifier(node.next, `${path}.next`); if (next !== "done" && !Object.hasOwn(nodes, next)) invalid(`${path}.next`, "unknown node");
    for (const [port, ref] of Object.entries(object(node.out, `${path}.out`))) {
      identifier(port, `${path}.out.${port}`); if (!Object.hasOwn(contracts, text(ref, `${path}.out.${port}`))) invalid(`${path}.out.${port}`, "unknown contract alias");
    }
    for (const [port, rawInput] of Object.entries(object(node.in, `${path}.in`))) {
      identifier(port, `${path}.in.${port}`); const input = object(rawInput, `${path}.in.${port}`); keys(input, `${path}.in.${port}`, ["from", "contract"]);
      const contract = text(input.contract, `${path}.in.${port}.contract`), from = text(input.from, `${path}.in.${port}.from`);
      if (!Object.hasOwn(contracts, contract)) invalid(`${path}.in.${port}.contract`, "unknown contract alias");
      if (from === "run.intent") { if (contracts[contract] !== "engine:job-intent@1") invalid(`${path}.in.${port}.contract`, "run.intent requires the intent contract"); continue; }
      const match = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(from);
      if (!match || !Object.hasOwn(nodes, match[1])) invalid(`${path}.in.${port}.from`, "unknown producer");
      const outputs = object(object(nodes[match[1]], `workflow.nodes.${match[1]}`).out, `workflow.nodes.${match[1]}.out`);
      if (!Object.hasOwn(outputs, match[2]) || contracts[String(outputs[match[2]])] !== contracts[contract]) invalid(`${path}.in.${port}`, "missing producer port or incompatible contract");
    }
    if (node.repair !== undefined) {
      const repair = object(node.repair, `${path}.repair`); keys(repair, `${path}.repair`, ["to", "bound"]);
      if (!node.mechanical) invalid(`${path}.repair`, "only mechanical quality gates may route repairs");
      choice(repair.bound, `${path}.repair.bound`, ["run.caps.rounds"]);
      identifier(repair.to, `${path}.repair.to`); if (!Object.hasOwn(nodes, String(repair.to))) invalid(`${path}.repair.to`, "unknown repair target");
    }
  }
  const workflow = value as unknown as WorkflowDefinition;
  const requirements: Record<string, { in: Record<string, string>; out: Record<string, string> }> = {
    "selected.planner": { in: { brief: "engine:project-brief@1" }, out: { plan: "sociotechnic/schemas/plan.schema.json#/$defs/plan" } },
    "selected.builder": { in: { plan: "sociotechnic/schemas/plan.schema.json#/$defs/plan", assignment: "engine:execution-assignment@1", approval: "engine:human-approval@1" }, out: { build: "sociotechnic/schemas/recipient-contract.v1.json#/$defs/build" } },
    "canonical-checks": { in: { build: "sociotechnic/schemas/recipient-contract.v1.json#/$defs/build" }, out: { checks: "engine:checks-report@1" } },
    "selected.reviewers": { in: { plan: "sociotechnic/schemas/plan.schema.json#/$defs/plan", build: "sociotechnic/schemas/recipient-contract.v1.json#/$defs/build", checks: "engine:checks-report@1" }, out: { reviews: "engine:review-bundle@1" } },
    "commit-and-evidence-gate": { in: { build: "sociotechnic/schemas/recipient-contract.v1.json#/$defs/build", checks: "engine:checks-report@1", reviews: "engine:review-bundle@1" }, out: { gate: "engine:quality-gate@1" } },
    "selected.approver": { in: { gate: "engine:quality-gate@1" }, out: { decision: "sociotechnic/schemas/recipient-contract.v1.json#/$defs/decision" } },
    "approve-plan-and-assignment": { in: { plan: "sociotechnic/schemas/plan.schema.json#/$defs/plan", assignment: "engine:execution-assignment@1" }, out: { approval: "engine:human-approval@1" } },
    "accept-result": { in: { "intent-review": "engine:intent-review@1" }, out: { approval: "engine:human-approval@1" } },
  };
  for (const [name, node] of Object.entries(workflow.nodes)) {
    const expected = requirements[node.agent ?? node.mechanical ?? node.human];
    if (!expected) continue;
    for (const [port, ref] of Object.entries(expected.in)) if (workflow.contracts[node.in[port]?.contract] !== ref) invalid(`workflow.nodes.${name}.in.${port}`, `required contract ${ref}`);
    for (const [port, ref] of Object.entries(expected.out)) if (workflow.contracts[node.out[port]] !== ref) invalid(`workflow.nodes.${name}.out.${port}`, `required contract ${ref}`);
  }
  const order: string[] = []; let cursor = workflow.entry;
  while (cursor !== "done") {
    if (!Object.hasOwn(nodes, cursor)) invalid("workflow.entry", "unknown entry node");
    if (order.includes(cursor)) invalid(`workflow.nodes.${cursor}.next`, "unbounded next cycle; use an explicit bounded repair");
    order.push(cursor); cursor = workflow.nodes[cursor].next;
  }
  if (order.length !== ids.length) invalid("workflow.nodes", "unreachable nodes are not executable");
  const required: [keyof Pick<WorkflowNode, "agent" | "mechanical" | "human">, string][] = [
    ["agent", "selected.planner"], ["human", "approve-plan-and-assignment"], ["agent", "selected.builder"],
    ["mechanical", "canonical-checks"], ["agent", "selected.reviewers"], ["mechanical", "commit-and-evidence-gate"], ["agent", "selected.approver"], ["human", "accept-result"],
  ];
  let previous = -1;
  for (const [key, actor] of required) {
    const matches = order.filter(id => workflow.nodes[id][key] === actor);
    if (matches.length !== 1) invalid("workflow.nodes", `expected exactly one ${actor} stage`);
    const position = order.indexOf(matches[0]); if (position <= previous) invalid(`workflow.nodes.${matches[0]}`, "route bypasses required stage order"); previous = position;
  }
  if (workflow.nodes[workflow.entry].agent !== "lead" || workflow.nodes[order[order.length - 1]].human !== "accept-result") invalid("workflow.entry", "lead intake and final human acceptance are required");
  const builder = order.find(id => workflow.nodes[id].agent === "selected.builder")!;
  for (const id of order) {
    const node = workflow.nodes[id], path = `workflow.nodes.${id}`;
    if (node.mechanical && (!node.repair || node.repair.to !== builder)) invalid(`${path}.repair`, "quality failures must repair through the bounded builder stage");
    if (node.agent === "selected.designer" && order.indexOf(id) > order.findIndex(key => workflow.nodes[key].agent === "selected.planner")) invalid(path, "design must precede planning");
    for (const [port, input] of Object.entries(node.in)) if (!input.from.startsWith("run.") && order.indexOf(input.from.split(".")[0]) >= order.indexOf(id)) invalid(`${path}.in.${port}.from`, "producer must precede its recipient");
  }
  return workflow;
}

export function loadWorkflow(path: string | URL = new URL("../workflows/default.yaml", import.meta.url)): WorkflowDefinition {
  return parseWorkflowYaml(readFileSync(path, "utf8"));
}
export function workflowDigest(definition: WorkflowDefinition): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    const encoded = JSON.stringify(value); if (encoded === undefined) invalid("workflow", "digest requires JSON values"); return encoded;
  }
  return createHash("sha256").update(canonical(definition)).digest("hex");
}
