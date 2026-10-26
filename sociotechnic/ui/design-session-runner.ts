import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Options, SessionStore, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Job } from "../src/job.ts";
import { transition } from "../src/job.ts";
import { mutateJob, readJob } from "../src/job-store.ts";
import { session, readBytes, readJson, readText, writeJsonAtomic, writeBytes } from "../src/record-store.ts";
import { recordBytes } from "../src/db/store.ts";
import { jobDir, stateDir, sociotechnicHome } from "../src/paths.ts";
import { verifyDriverLease } from "../src/driverlock.ts";
import { designSession, previewUrl, pinDesignStarter, designStarterBrief } from "../src/design-session.ts";
import type { DesignQuestion } from "../src/design-session.ts";
import type { DesignImage } from "../src/design-session.ts";
import { SociotechnicError } from "../src/errors.ts";
import { parseFrontmatter } from "../src/agents.ts";
import { materializeSkills } from "../src/agent-skills.ts";
import { agentEnvironment, activityLines, loadContext7, claudeConfigPath } from "./runner.ts";
import type { SdkQuery } from "./runner.ts";
import { tokenUsage } from "../src/token-usage.ts";
import { isClaudeEffort } from "../src/agent-models.ts";
import { designWriteAllowed } from "../src/design.ts";
export type DesignQuery = (params: Parameters<SdkQuery>[0]) => AsyncIterable<unknown>;
import { nativeImpeccable, regularFiles } from "./impeccable.ts";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
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
  const targetRepository = existsSync(initial.worktree) ? initial.worktree : initial.repo;
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
  let skillDirectory: string | undefined;
  let persistenceFailed = false;
  const failPersistence = (error: unknown): never => { persistenceFailed = true; abort.abort(); throw error; };
  const write = async (fn: (job: Job) => void) => { try { await update(fn); } catch (e) { failPersistence(e); } };
  let remainingMs = (initial.agentConfigurations?.["sociotechnic-designer"]?.timeoutMinutes ?? 40) * 60_000;
  let activeSince: number | null = null;
  const pauseClock = () => { clearTimeout(timer); if (activeSince !== null) remainingMs -= Date.now() - activeSince; activeSince = null; };
  const arm = () => { pauseClock(); activeSince = Date.now(); timer = setTimeout(() => abort.abort(), Math.max(0, remainingMs)); };
  const waiting = async (question: DesignQuestion | null = null) => { pauseClock(); await write((job) => { const s = designSession(job); s.state = "waiting"; s.question = question; if (job.status === "designing") transition(job, "design-input", "Waiting for your design response", new Date().toISOString()); }); };
  const working = async () => { arm(); await write((job) => { const s = designSession(job); s.state = "working"; s.question = null; if (job.status === "design-input") transition(job, "designing", "Claude is responding", new Date().toISOString()); }); };
  try {
    if (initial.execution?.kind === "docker-sandbox") throw new Error("Interactive design currently supports Local execution only. Docker design was refused before inference.");
    const config = initial.agentConfigurations?.["sociotechnic-designer"];
    if (!config || !isClaudeEffort(config.effort) || !config.tools.includes("Skill") || !config.tools.includes("Bash")) throw new Error("This run uses the retired design adapter. Native design conversations require Claude Code's Bash and Skill tools.");
    skillDirectory = mkdtempSync(join(tmpdir(), "sociotechnic-design-skills-"));
    const pinnedSkills = materializeSkills(config.skillResources, skillDirectory);
    mkdirSync(workspace, { recursive: true });
    const prefix = `design/session/${d.id}/workspace/`;
    const workspaceFiles = () => readdirSync(workspace).filter((name) => ![".claude", ".sdk", ".attachments", "node_modules", ".git"].includes(name) && !name.includes(".question")).flatMap((name) => {
      const path = join(workspace, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) return [];
      return stat.isDirectory() ? regularFiles(path) : stat.isFile() ? [path] : [];
    });
    await readJob(id, () => {
      for (const r of session().records.values()) if (r.path.startsWith(prefix)) {
        const target = resolve(workspace, r.path.slice(prefix.length));
        if (!target.startsWith(workspace + sep)) throw new Error("Stored design path escapes its workspace");
        if (existsSync(target) || !designWriteAllowed(target, join(workspace, ".unused"), workspace)) continue;
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, recordBytes(r));
      }
    });
    if (!d.skill) for (const file of ["PRODUCT.md", "DESIGN.md"]) if (existsSync(join(initial.worktree, file))) writeFileSync(join(workspace, file), readFileSync(join(initial.worktree, file)));
    const skill = nativeImpeccable(sociotechnicHome(), workspace);
    const syncArtifacts = async () => {
      const files = workspaceFiles();
      const bytes = files.map((p) => ({ path: prefix + relative(workspace, p), bytes: readFileSync(p) }));
      const targetHandoff = join(targetRepository, "HANDOFF.md");
      if (!files.some((path) => path === join(workspace, "HANDOFF.md")) && existsSync(targetHandoff) && lstatSync(targetHandoff).isFile()) bytes.push({ path: prefix + "HANDOFF.md", bytes: readFileSync(targetHandoff) });
      if (bytes.some((f) => f.bytes.length > 8 * 1024 * 1024) || bytes.reduce((n, f) => n + f.bytes.length, 0) > 64 * 1024 * 1024) throw new Error("Design artifacts exceed the session size limit");
      await write(() => {
        const current = new Set(bytes.map((f) => f.path));
        for (const p of session().records.keys()) if (p.startsWith(prefix) && !current.has(p)) session().records.delete(p);
        for (const f of bytes) writeBytes(join(jobDir(id), f.path), f.bytes);
      });
    };
    const assistantImages = (text: string): { text: string; images: DesignImage[] } => {
      const images: DesignImage[] = [];
      const displayText = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (markup: string, reference: string) => {
        const candidate = reference.replace(/^<|>$/g, "");
        if (/^https?:|^data:/i.test(candidate)) return markup;
        let paths: string[];
        try { paths = candidate.startsWith("file:") ? [fileURLToPath(candidate)] : [resolve(workspace, candidate), resolve(targetRepository, candidate)]; }
        catch { return markup; }
        const path = paths.find((file) => existsSync(file) && lstatSync(file).isFile());
        if (!path) return markup;
        const extension = extname(path).toLowerCase();
        const mediaType = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : extension === ".gif" ? "image/gif" : extension === ".webp" ? "image/webp" : null;
        if (!mediaType || lstatSync(path).size > 8 * 1024 * 1024 || ![workspace, targetRepository].some((root) => existsSync(root) && realpathSync(path).startsWith(realpathSync(root) + sep))) return markup;
        const bytes = readFileSync(path), sha256 = createHash("sha256").update(bytes).digest("hex");
        const saved = join(workspace, ".chat-images", sha256 + extension);
        mkdirSync(dirname(saved), { recursive: true }); writeFileSync(saved, bytes);
        const record = prefix + relative(workspace, saved);
        if (!images.some((image) => image.record === record)) images.push({ name: basename(path), mediaType, sha256, record });
        return "";
      });
      return { text: displayText.trim(), images };
    };
    const nativeStore = sdkTranscriptStore(id, token);
    const store: SessionStore = { ...nativeStore, async append(key, entries) { try { await nativeStore.append(key, entries); } catch (e) { failPersistence(e); } } };
    const hasHistory = await readJob(id, () => [...session().records.keys()].some((p) => p.startsWith(`design/transcripts/${d.id}/`)));
    await write((job) => { pinDesignStarter(job); const s = designSession(job); s.skill = skill; s.error = null; s.question = null; if (s.streamingText) s.messages.push({ id: randomUUID(), role: "assistant", text: s.streamingText + "\n\n_Response interrupted._", at: new Date().toISOString() }); s.streamingText = ""; });
    const starterBrief = await readJob(id, designStarterBrief);
    const globalAgent = join(homedir(), ".claude/agents/sociotechnic-designer.md");
    const agentPath = process.env.SOCIOTECHNIC_DESIGN_AGENT ?? (existsSync(globalAgent) ? globalAgent : fileURLToPath(new URL("../global/agents/sociotechnic-designer.md", import.meta.url)));
    const agentRecord = join(jobDir(id), "design/agent.md");
    let agentSource = await readJob(id, () => session().records.has("design/agent.md") ? readText(agentRecord) : null);
    if (agentSource === null) {
      agentSource = readFileSync(agentPath, "utf8");
      const source = agentSource;
      await write(() => {
        writeBytes(agentRecord, Buffer.from(source));
        writeJsonAtomic(join(jobDir(id), "design/agent-source.json"), { path: agentPath, digest: createHash("sha256").update(source).digest("hex") });
      });
    }
    const rawDefinition = parseFrontmatter(agentSource)?.body ?? agentSource;
    if (!rawDefinition.trim()) throw new Error("The design agent Markdown file is empty");
    const options: Options = {
      cwd: workspace, additionalDirectories: [targetRepository, ...pinnedSkills.roots, ...(starterBrief ? [join(sociotechnicHome(), "sociotechnic/scaffolds/react-nest/template")] : [])], settingSources: ["user", "project", "local"],
      tools: config.tools.filter((t) => !t.startsWith("mcp__")),
      allowedTools: config.tools.filter((t) => t !== "AskUserQuestion"),
      model: config.model, effort: config.effort, maxTurns: config.maxTurns, persistSession: true,
      ...(hasHistory ? { resume: d.id } : { sessionId: d.id }), sessionStore: store, sessionStoreFlush: "eager",
      abortController: abort, includePartialMessages: true,
      env: { ...agentEnvironment(), CLAUDE_CODE_PROJECT_DIR_NAME: `design-${d.id}` },
      systemPrompt: { type: "preset", preset: "claude_code", append: `${rawDefinition}${pinnedSkills.prompt}\n${starterBrief}\nWorkspace: ${workspace}. Target repository: ${targetRepository}.\nAssignment: ${d.reason}\nMarkdown work product: ${join(workspace, "HANDOFF.md")}\nInstalled impeccable launcher: ${skill.executable}.` },
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
          if (h.tool_name === "Bash" && object(h.tool_input) && typeof h.tool_input.command === "string" && h.tool_input.command.includes("serve-question") && h.tool_input.command.includes("--wait")) { await syncArtifacts(); await waiting(); }
          return {};
        }] }],
        PostToolUse: [{ hooks: [async (h) => {
          if (h.hook_event_name !== "PostToolUse") return {};
          if (h.tool_name === "Bash") {
            const output = JSON.stringify(h.tool_response);
            const match = output.match(/QUESTION URL: (http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+[^\s"\\<>]*)/);
            const url = previewUrl(match?.[1]);
            if (url) await write((job) => { designSession(job).previewUrl = url; });
            await syncArtifacts(); await working();
          }
          return {};
        }] }],
      },
    };
    const context7 = loadContext7(claudeConfigPath());
    if (context7) options.mcpServers = { ...options.mcpServers, context7 };
    let initialized = false, resultSeen = false, draft = "", lastDraftWrite = 0;
    const message = hasHistory ? d.input?.text ?? "Continue our design conversation." : `/impeccable ${initial.feature}${d.input ? `\n\n${d.input.text}` : ""}`;
    const imageBytes = await readJob(id, () => (d.input?.images ?? []).map((image) => ({ image, bytes: readBytes(join(jobDir(id), image.record)) })));
    const content: Exclude<SDKUserMessage["message"]["content"], string>[number][] = [];
    if (message) content.push({ type: "text", text: message });
    for (const { image, bytes } of imageBytes) {
      const path = join(workspace, ".attachments", image.record.slice("design/uploads/".length));
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
      content.push({ type: "text", text: `Attached image: ${image.name}. Local file: ${path}` }, { type: "image", source: { type: "base64", media_type: image.mediaType, data: bytes.toString("base64") } });
    }
    async function* messages(): AsyncGenerator<SDKUserMessage> { yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: d.id, uuid: d.input?.id ?? d.id }; }
    const query = input.query ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
    await working();
    for await (const event of query({ prompt: messages(), options })) {
      if (!object(event) || typeof event.type !== "string") throw new Error("Invalid SDK event");
      if (persistenceFailed) throw new Error("Session persistence failed; further model work was stopped");
      for (const line of activityLines(event, d.id, "sociotechnic-designer")) onActivity(line);
      if (event.type === "system" && event.subtype === "init") {
        const commands = [...(Array.isArray(event.skills) ? event.skills : []), ...(Array.isArray(event.slash_commands) ? event.slash_commands : [])];
        if (event.session_id !== d.id || !commands.some((command) => typeof command === "string" && (command === "impeccable" || command.endsWith(":impeccable")))) throw new Error("The SDK did not register the installed impeccable command for this session");
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
        if (text) {
          const display = assistantImages(text);
          if (display.images.length) await syncArtifacts();
          await write((job) => { const s = designSession(job); s.streamingText = ""; draft = ""; if (!s.messages.some((m) => m.id === uuid)) s.messages.push({ id: uuid, role: "assistant", text: display.text, images: display.images, at: new Date().toISOString() }); });
        }
      }
      if (event.type === "system" && event.subtype === "mirror_error") throw new Error("SDK transcript persistence failed; session paused");
      if (event.type === "result") {
        resultSeen = true;
        await write((job) => {
          const s = designSession(job), u = tokenUsage({ modelUsage: event.modelUsage });
          s.usage = { input: u.input ?? s.usage.input, output: u.output ?? s.usage.output, cacheRead: u.cacheRead ?? s.usage.cacheRead, cacheWrite: u.cacheWrite ?? s.usage.cacheWrite, turns: d.usage.turns + (typeof event.num_turns === "number" ? event.num_turns : 0), reported: u.total !== null || s.usage.reported === true };
        });
        if (event.subtype !== "success" || event.is_error) throw new Error(`Claude session stopped: ${event.subtype}`);
      }
    }
    if (!initialized || !resultSeen) throw new Error("SDK session ended without a successful result");
    await syncArtifacts(); await waiting();
  } catch (error) {
    await write((job) => {
      const s = designSession(job);
      s.state = signal.aborted ? "interrupted" : "failed"; s.question = null;
      s.error = error instanceof Error ? error.message : String(error);
      if (job.status === "designing") transition(job, "design-input", s.error, new Date().toISOString()); else if (job.status === "design-input") job.statusReason = s.error;
    });
  } finally { pauseClock(); pending.delete(id); signal.removeEventListener("abort", cancel); abort.abort(); if (skillDirectory) rmSync(skillDirectory, { recursive: true, force: true }); }
}
