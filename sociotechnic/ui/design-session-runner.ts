import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Options, SessionStore, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Job } from "../src/job.ts";
import { transition } from "../src/job.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { session, readJson, writeJsonAtomic, writeBytes } from "../src/record-store.ts";
import { recordBytes } from "../src/db/store.ts";
import { jobDir, stateDir, sociotechnicHome } from "../src/paths.ts";
import { verifyDriverLease } from "../src/driverlock.ts";
import { designSession, previewUrl, pinDesignStarter, designStarterBrief } from "../src/design-session.ts";
import type { SkillInstallation } from "../src/design-session.ts";
import type { DesignQuestion } from "../src/design-session.ts";
import { SociotechnicError } from "../src/errors.ts";
import { parseFrontmatter } from "../src/agents.ts";
import { agentEnvironment, activityLines, loadContext7, claudeConfigPath } from "./runner.ts";
import type { SdkQuery } from "./runner.ts";
import { tokenUsage } from "../src/token-usage.ts";
import { isClaudeEffort } from "../src/agent-models.ts";
import { designWriteAllowed } from "../src/design.ts";
export type DesignQuery = (params: Parameters<SdkQuery>[0]) => AsyncIterable<unknown>;
import { pinImpeccable, regularFiles, installationDigest, runNative } from "./impeccable-runtime.ts";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const localPreviews = new Map<string, { skill: SkillInstallation; workspace: string; keys: Set<string> }>();
const pending = new Map<string, { id: string; token: string; answer: (answers: Record<string, string>) => void }>();

export function parseQuestion(value: unknown, id: string): DesignQuestion {
  if (!object(value) || !Array.isArray(value.questions) || !value.questions.length) throw new Error("Claude returned an invalid question");
  return { id, questions: value.questions.map((q) => {
    if (!object(q) || typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) throw new Error("Claude returned an invalid question");
    return { question: q.question, header: q.header, multiSelect: q.multiSelect === true, options: q.options.map((o) => {
      if (!object(o) || typeof o.label !== "string" || typeof o.description !== "string") throw new Error("Claude returned an invalid question choice");
      return { label: o.label, description: o.description };
    }) };
  }) };
}

export async function answerDesignQuestion(id: string, requestId: unknown, raw: unknown): Promise<void> {
  const waiter = pending.get(id);
  if (!waiter || waiter.id !== requestId) throw new SociotechnicError("stale-design", "This question is no longer active; resume the session to ask again");
  if (!object(raw) || !Object.values(raw).every((v) => typeof v === "string" && v.trim() && v.length <= 6000)) throw new SociotechnicError("bad-design", "Answer each question");
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") answers[key] = value;
  await mutateJob(id, async (job) => {
    await verifyDriverLease(id, waiter.token);
    session().commitGuards = [() => verifyDriverLease(id, waiter.token)];
    const d = designSession(job);
    if (!d.question || d.question.id !== requestId || d.question.questions.some((q) => !answers[q.question])) throw new SociotechnicError("bad-design", "Answer each current question");
    d.answers[d.question.id] = answers;
    d.question = null;
    d.messages.push({ id: randomUUID(), role: "user", text: Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join("\n\n"), at: new Date().toISOString() });
  });
  waiter.answer(answers);
}

export function sdkTranscriptStore(id: string, token: string): SessionStore {
  const keyPath = (key: Parameters<SessionStore["append"]>[0]) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(key.projectKey) || !/^[a-zA-Z0-9-]+$/.test(key.sessionId) || (key.subpath && !/^[a-zA-Z0-9_/-]+$/.test(key.subpath))) throw new Error("Invalid SDK transcript identity");
    return join(jobDir(id), "design/transcripts", key.sessionId, `${key.subpath ?? "main"}.json`);
  };
  return {
    async append(key, entries) {
      await mutateJob(id, async (job) => {
        await verifyDriverLease(id, token);
        session().commitGuards = [() => verifyDriverLease(id, token)];
        if (key.sessionId !== designSession(job).id) throw new Error("SDK transcript belongs to another session");
        const path = keyPath(key);
        const value = session().records.has(relative(jobDir(id), path)) ? readJson(path) : [];
        if (!Array.isArray(value)) throw new Error("Invalid stored SDK transcript");
        const uuids = new Set(value.filter(object).map((v) => v.uuid).filter((v) => typeof v === "string"));
        for (const entry of entries) if (typeof entry.uuid !== "string" || !uuids.has(entry.uuid)) { value.push(entry); if (typeof entry.uuid === "string") uuids.add(entry.uuid); }
        writeJsonAtomic(path, value);
        const d = designSession(job);
        if (d.input && entries.some((entry) => entry.uuid === d.input?.id)) d.input = null;
      });
    },
    async load(key) {
      return readJob(id, (job) => {
        if (key.sessionId !== designSession(job).id) throw new Error("SDK session identity mismatch");
        const path = keyPath(key);
        if (!session().records.has(relative(jobDir(id), path))) return null;
        const value = readJson(path);
        if (!Array.isArray(value) || !value.every((v) => object(v) && typeof v.type === "string")) throw new Error("Invalid stored SDK transcript");
        return value;
      });
    },
    async listSubkeys(key) {
      return readJob(id, () => [...session().records.keys()].filter((p) => p.startsWith(`design/transcripts/${key.sessionId}/`) && !p.endsWith("/main.json")).map((p) => p.slice(`design/transcripts/${key.sessionId}/`.length, -5)));
    },
  };
}

export async function runInteractiveDesign(input: { id: string; token: string; signal: AbortSignal; onActivity: (line: string) => void; query?: DesignQuery }): Promise<void> {
  const { id, token, signal, onActivity } = input;
  const initial = await readJob(id, (job) => job);
  const d = designSession(initial);
  const workspace = join(stateDir(), "design-sessions", d.id);
  const update = (fn: (job: Job) => void) => mutateJob(id, async (job) => {
    await verifyDriverLease(id, token);
    session().commitGuards = [() => verifyDriverLease(id, token)];
    fn(job);
  });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let persistenceFailed = false;
  const failPersistence = (error: unknown): never => { persistenceFailed = true; abort.abort(); throw error; };
  const write = async (fn: (job: Job) => void) => { try { await update(fn); } catch (e) { failPersistence(e); } };
  let remainingMs = (initial.agentConfigurations?.["sociotechnic-designer"]?.timeoutMinutes ?? 40) * 60_000;
  let activeSince: number | null = null;
  const pauseClock = () => { clearTimeout(timer); if (activeSince !== null) remainingMs -= Date.now() - activeSince; activeSince = null; };
  const arm = () => { pauseClock(); activeSince = Date.now(); timer = setTimeout(() => abort.abort(), Math.max(0, remainingMs)); };
  const waiting = async (question: DesignQuestion | null = null) => { pauseClock(); await write((job) => { const s = designSession(job); s.state = "waiting"; s.question = question; if (job.status !== "design-input") transition(job, "design-input", "Waiting for your design response", new Date().toISOString()); }); };
  const working = async () => { arm(); await write((job) => { const s = designSession(job); s.state = "working"; s.question = null; if (job.status === "design-input") transition(job, "designing", "Claude is responding", new Date().toISOString()); }); };
  try {
    if (initial.execution?.kind === "docker-sandbox") throw new Error("Interactive design currently supports Local execution only. Docker design was refused before inference.");
    const config = initial.agentConfigurations?.["sociotechnic-designer"];
    if (!config || !isClaudeEffort(config.effort) || !config.tools.includes("Skill") || !config.tools.includes("mcp__impeccable__run")) throw new Error("This run pins the retired packet designer. Start a new run with the interactive designer release.");
    mkdirSync(workspace, { recursive: true });
    const prefix = `design/session/${d.id}/workspace/`;
    const workspaceFiles = () => regularFiles(workspace).filter((p) => !relative(workspace, p).startsWith(".claude/") && !relative(workspace, p).startsWith(".sdk/") && !relative(workspace, p).includes(".question"));
    // Validate existing paths before restoring, including symlinks in parent directories.
    const looseFiles = workspaceFiles();
    await readJob(id, () => {
      for (const path of looseFiles) if (!session().records.has(prefix + relative(workspace, path))) rmSync(path);
      for (const r of session().records.values()) if (r.path.startsWith(prefix)) {
        const target = resolve(workspace, r.path.slice(prefix.length));
        if (!target.startsWith(workspace + sep)) throw new Error("Stored design path escapes its workspace");
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, recordBytes(r));
      }
    });
    if (!d.skill) for (const file of ["PRODUCT.md", "DESIGN.md"]) if (existsSync(join(initial.worktree, file))) writeFileSync(join(workspace, file), readFileSync(join(initial.worktree, file)));
    const skill = await pinImpeccable(sociotechnicHome(), workspace, d.skill);
    localPreviews.set(id, { skill, workspace, keys: new Set(d.previewKeys) });
    const syncArtifacts = async () => {
      if (installationDigest(skill.root) !== skill.digest) throw new Error("The session's pinned Impeccable skill changed");
      const files = workspaceFiles();
      const bytes = files.map((p) => ({ path: prefix + relative(workspace, p), bytes: readFileSync(p) }));
      if (bytes.some((f) => f.bytes.length > 8 * 1024 * 1024) || bytes.reduce((n, f) => n + f.bytes.length, 0) > 64 * 1024 * 1024) throw new Error("Design artifacts exceed the session size limit");
      await write(() => {
        const current = new Set(bytes.map((f) => f.path));
        for (const p of session().records.keys()) if (p.startsWith(prefix) && !current.has(p)) session().records.delete(p);
        for (const f of bytes) writeBytes(join(jobDir(id), f.path), f.bytes);
      });
    };
    const nativeStore = sdkTranscriptStore(id, token);
    const store: SessionStore = { ...nativeStore, async append(key, entries) { try { await nativeStore.append(key, entries); } catch (e) { failPersistence(e); } } };
    const hasHistory = await readJob(id, () => [...session().records.keys()].some((p) => p.startsWith(`design/transcripts/${d.id}/`)));
    await write((job) => { pinDesignStarter(job); const s = designSession(job); s.skill = skill; s.error = null; s.question = null; if (s.streamingText) s.messages.push({ id: randomUUID(), role: "assistant", text: s.streamingText + "\n\n_Response interrupted._", at: new Date().toISOString() }); s.streamingText = ""; });
    const starterBrief = await readJob(id, designStarterBrief);
    const initialContext = hasHistory ? "" : await runNative(skill, workspace, ["context"], abort.signal);
    const rawDefinition = config.definition ? parseFrontmatter(config.definition)?.body : null;
    if (!rawDefinition) throw new Error("Pinned designer instructions are missing");
    const options: Options = {
      cwd: workspace, additionalDirectories: [initial.worktree, ...(starterBrief ? [join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template")] : [])], settingSources: ["project"], skills: ["impeccable"],
      tools: config.tools.filter((t) => !t.startsWith("mcp__")),
      allowedTools: config.tools.filter((t) => t !== "AskUserQuestion"),
      model: config.model, effort: config.effort, maxTurns: config.maxTurns, persistSession: true,
      ...(hasHistory ? { resume: d.id } : { sessionId: d.id }), sessionStore: store, sessionStoreFlush: "eager",
      abortController: abort, includePartialMessages: true,
      env: { ...agentEnvironment(), CLAUDE_CODE_PROJECT_DIR_NAME: `design-${d.id}` },
      systemPrompt: { type: "preset", preset: "claude_code", append: `${rawDefinition}\n${starterBrief}\nDesign workspace: ${workspace}. Target repository (read-only): ${initial.worktree}. Read its actual content and conventions. This is design only; write design documents, previews and skill state only in the workspace. Run the actual impeccable skill. Use mcp__impeccable__run for every command of its CLI with the native argument vector; it executes the installed engine without a shell. Its serve-question page opens through the console's Open previews action. AskUserQuestion and ordinary conversational replies reach the human. Follow the skill's workflow rather than a fixed sequence of packets. Stop before application implementation. When ready for approval, retain DESIGN.md and the preview files in this workspace and explain the chosen result to the human.` },
      mcpServers: { impeccable: { command: process.execPath, args: [join(sociotechnicHome(), "sociotechnic/ui/impeccable-runtime.ts")], env: { SOCIOTECHNIC_DESIGN_WORKSPACE: workspace, SOCIOTECHNIC_DESIGN_SESSION: d.id, SOCIOTECHNIC_DESIGN_SKILL_DIGEST: skill.digest, SOCIOTECHNIC_DESIGN_REFERENCE_ROOT: initial.worktree } } },
      canUseTool: async (name, value, context) => {
        if (name !== "AskUserQuestion") return { behavior: "deny", message: "This operation is outside the design session's permitted tools" };
        const question = parseQuestion(value, context.toolUseID);
        const recorded = await readJob(id, (job) => designSession(job).answers[question.id]);
        if (recorded) return { behavior: "allow", updatedInput: { ...value, answers: recorded } };
        await syncArtifacts(); await waiting(question);
        try {
          const answers = await new Promise<Record<string, string>>((done, fail) => {
            const cancelled = () => fail(new Error("Question interrupted; resume the same session"));
            context.signal.addEventListener("abort", cancelled, { once: true });
            pending.set(id, { id: question.id, token, answer: (answer) => { context.signal.removeEventListener("abort", cancelled); done(answer); } });
            if (context.signal.aborted) cancelled();
          });
          await working();
          return { behavior: "allow", updatedInput: { ...value, answers } };
        } finally { pending.delete(id); }
      },
      hooks: {
        PreToolUse: [{ hooks: [async (h) => {
          if (h.hook_event_name !== "PreToolUse") return {};
          if (["Write", "Edit"].includes(h.tool_name)) {
            const path = object(h.tool_input) && typeof h.tool_input.file_path === "string" ? resolve(workspace, h.tool_input.file_path) : "";
            if (!designWriteAllowed(path, join(workspace, ".unused"), workspace) || path.startsWith(join(workspace, ".claude") + sep) || path.startsWith(join(workspace, ".sdk") + sep)) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Write design artifacts only inside this session's workspace" } };
          }
          if (h.tool_name === "mcp__impeccable__run" && object(h.tool_input) && Array.isArray(h.tool_input.args) && h.tool_input.args.includes("--wait")) { await syncArtifacts(); await waiting(); }
          return {};
        }] }],
        PostToolUse: [{ hooks: [async (h) => {
          if (h.hook_event_name !== "PostToolUse") return {};
          if (h.tool_name === "mcp__impeccable__run") {
            const output = JSON.stringify(h.tool_response);
            const match = output.match(/QUESTION URL: (http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+[^\s"\\<>]*)/);
            const url = previewUrl(match?.[1]);
            const key = output.match(/QUESTION KEY: ([a-zA-Z0-9_-]+)/)?.[1];
            if (key?.startsWith(`${d.id}-`)) localPreviews.get(id)?.keys.add(key);
            if (url || key) await write((job) => { const s = designSession(job); if (url) s.previewUrl = url; if (key?.startsWith(`${s.id}-`) && !s.previewKeys.includes(key)) s.previewKeys.push(key); });
            onActivity(`Impeccable: ${output.slice(0, 1000)}`);
            await syncArtifacts(); await working();
          }
          return {};
        }] }],
      },
    };
    const context7 = loadContext7(claudeConfigPath());
    if (context7) options.mcpServers = { ...options.mcpServers, context7 };
    let initialized = false, resultSeen = false, draft = "", lastDraftWrite = 0;
    const message = hasHistory ? d.input?.text ?? "Continue our design conversation." : `/impeccable shape ${initial.feature}\n\n${d.input ? `Additional human message: ${d.input.text}\n\n` : ""}The host preflight has already run the actual Impeccable context command for this session. Use that context below and do not repeat it. Read the actual skill and continue its workflow.\n${initialContext}`;
    async function* messages(): AsyncGenerator<SDKUserMessage> { yield { type: "user", message: { role: "user", content: message }, parent_tool_use_id: null, session_id: d.id, uuid: d.input?.id ?? d.id }; }
    const query = input.query ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
    await working();
    for await (const event of query({ prompt: messages(), options })) {
      if (!object(event) || typeof event.type !== "string") throw new Error("Invalid SDK event");
      if (persistenceFailed) throw new Error("Session persistence failed; further model work was stopped");
      for (const line of activityLines(event, d.id, "sociotechnic-designer")) onActivity(line);
      if (event.type === "system" && event.subtype === "init") {
        if (event.session_id !== d.id || (!Array.isArray(event.skills) || !event.skills.includes("impeccable"))) throw new Error("The SDK did not load the pinned Impeccable skill and session");
        initialized = true;

      }
      if (!initialized && event.type === "assistant") throw new Error("Model work began without confirmed Impeccable skill loading");
      if (event.type === "stream_event" && object(event.event) && event.event.type === "content_block_delta" && object(event.event.delta) && event.event.delta.type === "text_delta" && typeof event.event.delta.text === "string") {
        draft += event.event.delta.text;
        if (draft.length > 200_000) throw new Error("The streamed response exceeded its display limit");
        if (Date.now() - lastDraftWrite >= 250) { await write((job) => { designSession(job).streamingText = draft; }); lastDraftWrite = Date.now(); }
      }
      if (event.type === "assistant") {
        if (!object(event.message) || !Array.isArray(event.message.content) || typeof event.uuid !== "string") throw new Error("Invalid assistant message");
        const uuid = event.uuid;
        const text = event.message.content.filter(object).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n\n");
        if (text) await write((job) => { const s = designSession(job); s.streamingText = ""; draft = ""; if (!s.messages.some((m) => m.id === uuid)) s.messages.push({ id: uuid, role: "assistant", text, at: new Date().toISOString() }); });
      }
      if (event.type === "system" && event.subtype === "mirror_error") throw new Error("SDK transcript persistence failed; session paused");
      if (event.type === "result") {
        resultSeen = true;
        if (event.subtype !== "success" || event.is_error) throw new Error(`Claude session stopped: ${event.subtype}`);
        await write((job) => {
          const s = designSession(job), u = tokenUsage({ modelUsage: event.modelUsage });
          s.usage = { input: u.input ?? s.usage.input, output: u.output ?? s.usage.output, cacheRead: u.cacheRead ?? s.usage.cacheRead, cacheWrite: u.cacheWrite ?? s.usage.cacheWrite, turns: d.usage.turns + (typeof event.num_turns === "number" ? event.num_turns : 0) };
        });
      }
    }
    if (!initialized || !resultSeen) throw new Error("SDK session ended without a successful result");
    await syncArtifacts(); await waiting();
  } catch (error) {
    await write((job) => {
      const s = designSession(job);
      s.state = signal.aborted ? "interrupted" : "failed"; s.question = null;
      s.error = error instanceof Error ? error.message : String(error);
      if (job.status !== "stopped" && job.status !== "design-input") transition(job, "design-input", s.error, new Date().toISOString()); else if (job.status === "design-input") job.statusReason = s.error;
    });
  } finally { pauseClock(); pending.delete(id); signal.removeEventListener("abort", cancel); abort.abort(); if (signal.aborted) await stopDesignPreviews(id).catch((e: unknown) => onActivity(`Preview cleanup requires attention: ${e instanceof Error ? e.message : String(e)}`)); }
}


export async function stopDesignPreviews(id: string): Promise<void> {
  const d = await readJob(id, (job) => job.designSession);
  if (!d?.skill || !d.previewKeys.length) return;
  const keys = [...d.previewKeys];
  const workspace = join(stateDir(), "design-sessions", d.id);
  for (const key of keys) {
    if (!key.startsWith(`${d.id}-`)) throw new Error("Preview key does not belong to this session");
    await runNative(d.skill, workspace, ["serve-question", "--stop", "--key", key]);
  }
  for (const key of keys) localPreviews.get(id)?.keys.delete(key);
  await mutateJob(id, (job) => { const current = designSession(job); current.previewKeys = current.previewKeys.filter((key) => !keys.includes(key)); if (!current.previewKeys.length) current.previewUrl = null; });
}

export async function stopLocalDesignPreviews(id: string): Promise<void> {
  const owned = localPreviews.get(id);
  if (!owned) return;
  for (const key of owned.keys) await runNative(owned.skill, owned.workspace, ["serve-question", "--stop", "--key", key]);
  localPreviews.delete(id);
}
