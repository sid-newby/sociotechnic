import assert from "node:assert/strict";
import { test } from "node:test";
import { bundledAgentDefinition, isToolName, validateBundledAgents, validateAgentText } from "../src/agents.ts";
import { needsContext7, roleOf, ROLES } from "../src/roles.ts";


test("section 2 table matches the fourteen bundled agent seeds", () => {
  assert.equal(ROLES.length, 14);
  const report = validateBundledAgents();
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
});

test("a drifted agent file is reported", () => {
  const role = roleOf("sociotechnic-reviewer-code");
  const text = bundledAgentDefinition("sociotechnic-reviewer-code");
  const drifted = text.replace(/^model: .*$/m, "model: haiku").replace(/^tools: .*$/m, "tools: Read, Grep, Glob, Write, Bash");
  const problems = validateAgentText(role, drifted);
  assert.ok(problems.some((p) => p.includes("model")));
  assert.ok(problems.some((p) => p.includes("tools")));
  const unguarded = text.replace(/^hooks:[\s\S]*?(?=^---)/m, "");
  assert.ok(validateAgentText(role, unguarded).some((p) => p.includes("guard-write")));
});

test("network roles carry web and Context7 tools; the offline roles do not", () => {
  const c7 = ["mcp__context7__resolve-library-id", "mcp__context7__query-docs"];
  const web = ["WebSearch", "WebFetch"];
  for (const name of ["sociotechnic-planner", "sociotechnic-researcher"]) assert.deepEqual(roleOf(name).tools, ["Read", "Grep", "Glob", "Write", ...web, ...c7]);
  for (const name of ["sociotechnic-builder", "sociotechnic-builder-lite"]) assert.deepEqual(roleOf(name).tools, ["Read", "Grep", "Glob", "Bash", "Edit", "Write", ...web, ...c7]);
  assert.deepEqual(roleOf("sociotechnic-reviewer-security").tools, ["Read", "Grep", "Glob", "Write", ...web]);
  assert.deepEqual(roleOf("sociotechnic-sweeper").tools, ["Read", "Grep", "Glob", "Bash", "Edit", "Write"]);
  for (const name of ["sociotechnic-reviewer-code", "sociotechnic-reviewer-ux", "sociotechnic-reviewer-ui", "sociotechnic-conformance", "sociotechnic-approver"]) {
    assert.deepEqual(roleOf(name).tools, ["Read", "Grep", "Glob", "Write"]);
  }
});

test("needsContext7 is true exactly for roles with a Context7 tool", () => {
  const yes = ROLES.filter(needsContext7).map((r) => r.name);
  assert.deepEqual(yes, ["sociotechnic-designer", "sociotechnic-planner", "sociotechnic-researcher", "sociotechnic-builder", "sociotechnic-builder-lite"]);
  assert.equal(needsContext7(roleOf("sociotechnic-reviewer-security")), false);
});

test("MCP tool names validate; malformed names and reordered tools are reported", () => {
  for (const role of ROLES) for (const t of role.tools) assert.ok(isToolName(t), t);
  assert.equal(isToolName("mcp__context7__resolve-library-id"), true);
  assert.equal(isToolName("mcp__context7"), false);
  assert.equal(isToolName("web search"), false);
  const role = roleOf("sociotechnic-researcher");
  const text = bundledAgentDefinition("sociotechnic-researcher");
  const reordered = text.replace(/^tools: .*$/m, `tools: ${[...role.tools].reverse().join(", ")}`);
  assert.ok(validateAgentText(role, reordered).some((p) => p.includes("tools are")));
  const bad = text.replace(/^tools: .*$/m, `tools: ${role.tools.join(", ")}, mcp__context7`);
  assert.ok(validateAgentText(role, bad).some((p) => p.includes("invalid tool name")));
});
