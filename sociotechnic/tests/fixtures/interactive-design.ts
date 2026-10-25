import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DesignQuery } from "../../ui/design-session-runner.ts";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export const fixtureDesignQuery: DesignQuery = async function* ({ prompt, options }) {
  const id = options.resume ?? options.sessionId;
  if (!id || !options.cwd || !options.sessionStore || !options.canUseTool) throw new Error("Missing native session configuration");
  let text = typeof prompt === "string" ? prompt : "";
  let userMessage: SDKUserMessage["message"] = { role: "user", content: text };
  let messageId = randomUUID();
  if (typeof prompt !== "string") for await (const m of prompt) { userMessage = m.message; text += typeof m.message.content === "string" ? m.message.content : m.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n"); messageId = m.uuid ?? messageId; }
  yield { type: "system", subtype: "init", session_id: id, skills: ["impeccable"] };
  const key = { projectKey: `design-${id}`, sessionId: id };
  const prior = await options.sessionStore.load(key) ?? [];
  await options.sessionStore.append(key, [{ type: "user", uuid: messageId, message: userMessage }]);
  if (text.includes("hold response")) { await new Promise<void>((_, reject) => { const abort = () => reject(new Error("Fixture interrupted")); options.abortController?.signal.addEventListener("abort", abort, { once: true }); if (options.abortController?.signal.aborted) abort(); }); }
  let answer = "";
  if (!options.resume) {
    const response = await options.canUseTool("AskUserQuestion", { questions: [{ header: "Audience", question: "Who will use this workspace?", multiSelect: false, options: [{ label: "Researchers", description: "Read and connect evidence" }, { label: "Editors", description: "Prepare material for publication" }] }] }, { signal: options.abortController?.signal ?? new AbortController().signal, toolUseID: randomUUID(), requestId: randomUUID() });
    if (!response || response.behavior !== "allow") throw new Error("Question not answered");
    answer = JSON.stringify(response.updatedInput);
  }
  mkdirSync(join(options.cwd, "previews"), { recursive: true });
  writeFileSync(join(options.cwd, "DESIGN.md"), `# Design\nConfirmed audience: ${answer || "retained from our conversation"}.\n${text.includes("denser") ? "Use a denser reading layout." : "Use a calm reading workspace."}\n`);
  writeFileSync(join(options.cwd, "HANDOFF.md"), "# Design work product\n\nUse a reading workspace for the confirmed audience. Preserve the human's decisions across revisions.\n\n## Artifacts\n\n- [Design notes](DESIGN.md) document the agreed direction.\n- [Research desk prototype](previews/desk.html) opens in a separate browser tab; no build command is needed.\n\n## Validation and remaining work\n\nThese artifacts are deterministic integration fixtures, not live model output. Responsive behavior and production implementation remain unverified. The planner should assess this work, plan implementation and hold for normal plan review before a builder starts.\n");
  writeFileSync(join(options.cwd, "previews/desk.html"), "<!doctype html><title>Fixture preview</title><h1>Research desk</h1><p>Deterministic integration fixture. No model generated this design.</p>");
  const content = `Integration fixture: ${options.resume ? "I retained our previous conversation and revised the design." : "Thank you. Here is the initial direction."} ${prior.length} prior transcript entries.`;
  const uuid = randomUUID();
  await options.sessionStore.append(key, [{ type: "assistant", uuid, message: { role: "assistant", content } }]);
  yield { type: "assistant", uuid, message: { content: [{ type: "text", text: content }] } };
  yield { type: "result", subtype: "success", is_error: false, num_turns: 2, modelUsage: { fixture: { inputTokens: options.resume ? 20 : 10, outputTokens: options.resume ? 40 : 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
};
