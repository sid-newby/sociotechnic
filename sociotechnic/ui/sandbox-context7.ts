import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS = ["resolve-library-id", "query-docs"];
export const CONTEXT7_SETUP = "Sandbox Context7 is unavailable. Register context7 with sbx mcp add, configure its host credentials, and load it with sbx mcp load context7 --sandbox <name>. See sociotechnic/docs/docker-sandboxes.md#context7-and-the-mcp-gateway.";

export function sandboxContext7Server(home: string): McpServerConfig {
  return { command: process.execPath, args: [join(home, "sociotechnic/ui/sandbox-context7.ts")] };
}

export async function connectContext7Gateway(signal?: AbortSignal) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "sociotechnic-context7", version: "1.0.0" });
  try {
    const url = new URL(process.env.MCP_GATEWAY_URL ?? "");
    if (url.origin !== "http://mcp-gateway.docker.internal" || url.pathname !== "/mcp" || url.search || url.hash || url.username || url.password || process.env.MCP_SENTINEL_TOKEN_NAME !== "proxy-managed") throw new Error(CONTEXT7_SETUP);
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer proxy-managed" } } });
    const bounded = AbortSignal.timeout(15_000);
    const options = { signal: signal ? AbortSignal.any([signal, bounded]) : bounded, timeout: 15_000 };
    await client.connect(transport, options);
    const tools: Awaited<ReturnType<typeof client.listTools>>["tools"] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await client.listTools(cursor ? { cursor } : undefined, options);
      tools.push(...page.tools.filter((tool) => TOOLS.includes(tool.name)));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    if (cursor || TOOLS.some((name) => tools.filter((tool) => tool.name === name).length !== 1)) throw new Error(CONTEXT7_SETUP);
    return { tools, call: (name: string, args: Record<string, unknown> | undefined) => {
      if (!TOOLS.includes(name)) throw new Error("Context7 tool is not permitted");
      return client.callTool({ name, arguments: args }, undefined, { signal, timeout: 60_000 });
    }, close: () => client.close() };
  } catch {
    await client.close().catch(() => {});
    throw new Error(CONTEXT7_SETUP);
  }
}

async function serve(): Promise<void> {
  const gateway = await connectContext7Gateway();
  if (process.argv.includes("--check")) {
    process.stdout.write(JSON.stringify(gateway.tools.map((tool) => tool.name)) + "\n");
    await gateway.close();
    return;
  }
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const server = new Server({ name: "context7", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: gateway.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try { return await gateway.call(request.params.name, request.params.arguments); }
    catch { return { isError: true, content: [{ type: "text", text: "Context7 request failed; inspect the host gateway registration and credentials." }] }; }
  });
  server.onclose = () => { void gateway.close(); };
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve().catch(() => { process.stderr.write(CONTEXT7_SETUP + "\n"); process.exitCode = 1; });
}
