#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const args = process.argv.slice(2);
assert.equal(args[0], "exec");
for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--json"]) assert.ok(args.includes(flag));
for (const setting of ['forced_login_method="chatgpt"', 'features.code_mode_host=true', 'features.plugins=false', 'features.hooks=false', 'features.multi_agent=false']) assert.ok(args.includes(setting));
const builder = args[args.indexOf("--sandbox") + 1] === "workspace-write";
assert.ok(args.includes(`features.shell_tool=${builder}`));
assert.equal(args.includes("--add-dir"), false);
if (builder) assert.ok(args.includes(`sandbox_workspace_write.network_access=${process.env.SOCIOTECHNIC_CODEX_TEST_NETWORK === "live"}`));
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.CODEX_API_KEY, undefined);
assert.equal(process.env.CODEX_ACCESS_TOKEN, undefined);
if (process.env.SOCIOTECHNIC_CODEX_TEST_NETWORK) assert.ok(args.includes(`web_search=${JSON.stringify(process.env.SOCIOTECHNIC_CODEX_TEST_NETWORK)}`));
if (process.env.SOCIOTECHNIC_CODEX_TEST_MODEL) assert.equal(args[args.indexOf("--model") + 1], process.env.SOCIOTECHNIC_CODEX_TEST_MODEL);
if (process.env.SOCIOTECHNIC_CODEX_TEST_EFFORT) assert.ok(args.includes(`model_reasoning_effort=${JSON.stringify(process.env.SOCIOTECHNIC_CODEX_TEST_EFFORT)}`));
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
assert.ok(prompt.includes("Return ONLY the complete required record"));
const budget = /Execution limits: (\d+) completed tool operations total/.exec(prompt);
assert.ok(budget, "runtime must disclose the actual completed-operation limit");
assert.ok(prompt.includes("not per tool and not model turns"));
assert.ok(prompt.includes("final response itself needs no tool call"));
assert.match(prompt, /Deadline: \d{4}-\d\d-\d\dT/);
const output = args[args.indexOf("--output-last-message") + 1];
const mode = process.env.SOCIOTECHNIC_CODEX_TEST_MODE;
if (mode === "hang") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(process.env.SOCIOTECHNIC_CODEX_TEST_PID, String(child.pid));
  setInterval(() => {}, 1000);
} else if (mode === "failed") {
  writeFileSync(output, "VERDICT: PASS\nCOMMIT: " + "a".repeat(40));
  console.log(JSON.stringify({ type: "turn.failed", error: { message: "secret failure details" } }));
} else {
  const rootFile = JSON.parse(args.find((a) => a.startsWith("mcp_servers.sociotechnic.args=")).split("=").slice(1).join("="));
  const roots = JSON.parse(readFileSync(rootFile[1], "utf8")).roots;
  const mcp = spawn(process.execPath, rootFile, { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: mcp.stdout });
  const request = (params) => {
    const answer = new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));
    mcp.stdin.write(JSON.stringify(params) + "\n");
    return answer;
  };
  const listed = await request({ jsonrpc: "2.0", id: 0, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["read_file", "glob", "grep", ...(builder ? ["commit_changes"] : [])]);
  for (const tool of listed.result.tools) assert.equal(tool.annotations.readOnlyHint, tool.name !== "commit_changes");
  const answer = new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_file", arguments: { path: roots[0] + "/evidence.txt" } } }) + "\n");
  const result = await answer;
  assert.equal(result.result.isError, undefined);
  assert.ok(result.result.content[0].text.includes("1: evidence"));
  if (process.env.SOCIOTECHNIC_CODEX_TEST_SKILLS === "1") {
    assert.ok(prompt.includes("Pinned instruction skills"));
    assert.ok(roots.length > 3);
    const resource = await request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_file", arguments: { path: roots[3] + "/references/detail.md" } } });
    assert.ok(resource.result.content[0].text.includes("Pinned reference evidence"));
  }
  if (process.env.SOCIOTECHNIC_CODEX_TEST_WRITING_ROOT) {
    assert.ok(prompt.includes("Attached skill: team-writing"));
    assert.ok(prompt.includes("Preserve facts, quantities, negation, uncertainty"));
    const root = roots.find((path) => path.endsWith("/team-writing")); assert.ok(root);
    const resource = await request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_file", arguments: { path: root + "/references/technical-writing.md" } } });
    assert.equal(resource.result.isError, undefined);
    assert.ok(resource.result.content[0].text.includes("# Technical writing"));
    writeFileSync(process.env.SOCIOTECHNIC_CODEX_TEST_WRITING_ROOT, root);
  }
  mcp.stdin.end();
  console.log(JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "read_file" } }));
  if (mode === "budget") for (let i = 0; i < 70; i++) console.log(JSON.stringify({ type: "item.completed", item: { type: "web_search" } }));
  if (mode === "at-budget" || mode === "over-budget") {
    for (let i = 1; i < Number(budget[1]) + (mode === "over-budget" ? 1 : 0); i++) {
      console.log(JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", tool: "read_file" } }));
      console.log(JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "read_file" } }));
    }
  }
  if (mode === "forbidden") console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }));
  if (builder) {
    const worktree = args[args.indexOf("--cd") + 1];
    writeFileSync(join(worktree, "built.txt"), "built\n");
    for (const type of ["command_execution", "file_change"]) console.log(JSON.stringify({ type: "item.completed", item: { type } }));
  }
  writeFileSync(output, builder ? "STATUS: READY\nCOMMIT: " + "a".repeat(40) + "\n\n## Acceptance\n- [x] Built fixture.\n" : args[args.indexOf("--model") + 1] === "gpt-6-luna" ? "STATUS: DONE\n\n## Answer\nEvidence found.\n\n## Evidence\n- evidence.txt:1 — evidence\n" : "VERDICT: PASS\nCOMMIT: " + "a".repeat(40) + "\n\n## Findings\nNone.\n\n## Notes\nRead evidence.txt.\n");
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } }));
}
