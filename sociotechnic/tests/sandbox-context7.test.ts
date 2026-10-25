import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { connectContext7Gateway, CONTEXT7_SETUP, sandboxContext7Server } from "../ui/sandbox-context7.ts";
import { context7ForExecution, runnerFromEnv, sdkOptions, sdkRunner } from "../ui/runner.ts";
import type { RunContext } from "../ui/runner.ts";
import { codexArgs } from "../ui/codex-runner.ts";
import { roleOf } from "../src/roles.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-context7-"));
const originalFetch = globalThis.fetch;
const saved = { url: process.env.MCP_GATEWAY_URL, sentinel: process.env.MCP_SENTINEL_TOKEN_NAME, config: process.env.SOCIOTECHNIC_CLAUDE_CONFIG, runner: process.env.SOCIOTECHNIC_RUNNER };
const approved = ["resolve-library-id", "query-docs"];
let names = [...approved, "mcp-exec", "mcp-add", "mcp-find", "mcp-config-set", "code-mode", "context7-revoke-auth", "delete-files"];
let denied = false, paginated = false;
const calls: string[] = [];
const server = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, "Bearer proxy-managed");
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  if (denied) { res.writeHead(403).end("credential must not leak"); return; }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (request.id === undefined) { res.writeHead(202).end(); return; }
  calls.push(request.method);
  let result: unknown;
  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  else if (request.method === "tools/list") {
    const selected = paginated ? (request.params?.cursor ? names.slice(1) : names.slice(0, 1)) : names;
    result = { tools: selected.map((name) => ({ name, inputSchema: { type: "object" } })), ...(paginated && !request.params?.cursor ? { nextCursor: "second" } : {}) };
  } else if (request.method === "tools/call") {
    calls.push(request.params.name);
    result = { content: [{ type: "text", text: JSON.stringify(request.params.arguments) }] };
  } else throw new Error("Unexpected gateway method");
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
});
before(async () => {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const endpoint = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "http://mcp-gateway.docker.internal");
    return originalFetch(new URL(url.pathname, endpoint), init);
  };
  process.env.MCP_GATEWAY_URL = "http://mcp-gateway.docker.internal/mcp";
  process.env.MCP_SENTINEL_TOKEN_NAME = "proxy-managed";
  process.env.SOCIOTECHNIC_CLAUDE_CONFIG = join(root, "host.json");
  writeFileSync(process.env.SOCIOTECHNIC_CLAUDE_CONFIG, JSON.stringify({ mcpServers: { context7: { type: "http", url: "https://host.invalid/mcp", headers: { Authorization: "host-secret" } } } }));
  delete process.env.SOCIOTECHNIC_RUNNER;
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({ MCP_GATEWAY_URL: saved.url, MCP_SENTINEL_TOKEN_NAME: saved.sentinel, SOCIOTECHNIC_CLAUDE_CONFIG: saved.config, SOCIOTECHNIC_RUNNER: saved.runner })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});
const ctx: RunContext = { sandboxed: true, sociotechnicHome: root, jobId: "test", repo: root, worktree: root, round: 1, recordPath: join(root, "result.md"), signal: new AbortController().signal, onActivity() {}, onWarn() { assert.fail("Sandbox must not silently drop Context7"); } };
const entry = { id: "d-001", agent: "sociotechnic-builder-lite", model: "sonnet", effort: "high", record: "build.md", prompt: "p", deadlineAt: new Date(Date.now() + 60_000).toISOString() };

test("real HTTP transport exposes only Context7, forwards arguments, and refuses gateway powers", async () => {
  paginated = true;
  const gateway = await connectContext7Gateway();
  try {
    assert.deepEqual(gateway.tools.map((tool) => tool.name), approved);
    for (const name of approved) {
      const result = await gateway.call(name, { query: "public docs" });
      assert.deepEqual(result.content, [{ type: "text", text: '{"query":"public docs"}' }]);
    }
    const before = calls.length;
    for (const name of names.filter((name) => !approved.includes(name))) assert.throws(() => gateway.call(name, {}), /not permitted/);
    assert.equal(calls.length, before);
  } finally { paginated = false; await gateway.close(); }
});
test("sandbox selection ignores host config and preserves both provider allowlists", async () => {
  const selected = await context7ForExecution(ctx);
  assert.deepEqual(selected, sandboxContext7Server(root));
  assert.equal(JSON.stringify(selected).includes("host-secret"), false);
  const role = roleOf(entry.agent);
  const options = sdkOptions(entry, role, root, new AbortController(), null, selected);
  assert.deepEqual(options.mcpServers, { context7: selected });
  assert.deepEqual(options.agents?.[role.name].tools, role.tools);
  const args = codexArgs("gpt-6.1-sol", "high", root, selected, true);
  assert.ok(args.includes('mcp_servers.context7.enabled_tools=["resolve-library-id","query-docs"]'));
  const local = await context7ForExecution({ ...ctx, sandboxed: undefined });
  assert.deepEqual(local, { type: "http", url: "https://host.invalid/mcp", headers: { Authorization: "host-secret" } });
});
test("missing tools and gateway failures block Claude and Codex before provider execution", async () => {
  let queried = false;
  const runner = sdkRunner(async function* () { queried = true; throw new Error("Provider must not run"); });
  const originalNames = names;
  try {
    names = ["resolve-library-id"];
    for (const agent of ["sociotechnic-builder-lite", "sociotechnic-planner"]) {
      const result = await runner.run({ ...entry, agent }, roleOf(agent), ctx);
      assert.equal(result.outcome, "failed"); assert.equal(result.note, CONTEXT7_SETUP);
    }
    const result = await runnerFromEnv().run({ ...entry, model: "gpt-6.1-sol" }, roleOf(entry.agent), ctx);
    assert.equal(result.outcome, "failed"); assert.equal(result.note, CONTEXT7_SETUP);
    assert.equal(queried, false);
    denied = true;
    await assert.rejects(connectContext7Gateway(), { message: CONTEXT7_SETUP });
    const abort = new AbortController(); abort.abort();
    await assert.rejects(connectContext7Gateway(abort.signal), { message: CONTEXT7_SETUP });
  } finally { names = originalNames; denied = false; }
});
test("roles without Context7 never connect to the gateway", async () => {
  let queried = 0;
  const runner = sdkRunner(async function* () { queried++; throw new Error("Fixture provider reached"); });
  const before = calls.length;
  for (const agent of ["sociotechnic-reviewer-ux", "sociotechnic-comment-cleaner"]) {
    const result = await runner.run({ ...entry, agent }, roleOf(agent), ctx);
    assert.equal(result.note, "Fixture provider reached");
  }
  assert.equal(queried, 2);
  assert.equal(calls.length, before);
});
test("missing or untrusted gateway metadata cannot become a host-config fallback", async () => {
  for (const url of ["", "https://untrusted.invalid/mcp", "http://mcp-gateway.docker.internal/mcp?token=secret"]) {
    process.env.MCP_GATEWAY_URL = url;
    await assert.rejects(context7ForExecution(ctx), { message: CONTEXT7_SETUP });
  }
  process.env.MCP_GATEWAY_URL = "http://mcp-gateway.docker.internal/mcp";
  process.env.MCP_SENTINEL_TOKEN_NAME = "real-credential-is-refused";
  try { await assert.rejects(context7ForExecution(ctx), { message: CONTEXT7_SETUP }); }
  finally { process.env.MCP_SENTINEL_TOKEN_NAME = "proxy-managed"; }
});
