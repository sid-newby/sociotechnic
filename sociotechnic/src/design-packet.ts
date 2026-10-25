import { SociotechnicError } from "./errors.ts";

export type DesignOption = { id: string; title: string; thesis: string; rationale: string; risk: string; preview: string };
export type DesignPacket = { title: string; strategy: string; product: string } & (
  | { phase: "interview"; questions: { id: string; prompt: string }[] }
  | { phase: "directions"; options: DesignOption[] }
  | { phase: "previews"; options: DesignOption[] }
);
export type StackChoice = { kind: "existing" } | { kind: "custom"; description: string } | { kind: "react-nest"; revision: string; digest: string };
export type DesignResponse = { action: "answer"; answers: Record<string, string>; stack: "existing" | "custom" | "react-nest"; customStack?: string }
  | { action: "select" | "approve"; optionId: string; confirmed?: boolean }
  | { action: "revise"; note: string };
export type DesignDecision = { record: string; digest: string; at: string; response: DesignResponse };
type CeremonyBase = { reason: string; iteration: number; decisions: DesignDecision[] };
export type DesignCeremony = CeremonyBase & (
  | { state: "generating"; steering: string | null; next: "interview" | "directions" | "previews"; stack: StackChoice | null }
  | { state: "waiting"; record: string; digest: string; packet: DesignPacket; stack: StackChoice | null }
  | { state: "approved"; record: string; digest: string; packet: Extract<DesignPacket, { phase: "previews" }>; optionId: string; stack: StackChoice; approvedAt: string }
);

function obj(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function str(v: unknown, max = 24_000): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
const ID = /^[a-z][a-z0-9-]{0,47}$/;
function invalid(message: string): never { throw new SociotechnicError("bad-design", message); }

export function parseDesignPacket(value: unknown): DesignPacket {
  if (!obj(value) || !str(value.title, 160) || !str(value.strategy) || typeof value.product !== "string" || value.product.length > 48_000) return invalid("Design packet needs title, strategy and product Markdown (empty only during interview)");
  const base = { title: value.title, strategy: value.strategy, product: value.product };
  if (value.phase === "interview") {
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3) return invalid("Interview needs 1..3 questions");
    const ids = new Set<string>();
    const questions = value.questions.map((q: unknown) => {
      if (!obj(q) || !str(q.id, 48) || !ID.test(q.id) || ids.has(q.id) || !str(q.prompt, 1200)) return invalid("Invalid or duplicate interview question");
      ids.add(q.id);
      return { id: q.id, prompt: q.prompt };
    });
    return { ...base, phase: value.phase, questions };
  }
  if (value.phase !== "directions" && value.phase !== "previews") return invalid("Unknown design phase");
  if (!str(value.product)) return invalid("Showcases require the confirmed product record");
  if (!Array.isArray(value.options) || value.options.length !== 3) return invalid("Showcase needs exactly three alternatives");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const options = value.options.map((o: unknown) => {
    if (!obj(o) || !str(o.id, 48) || !ID.test(o.id) || ids.has(o.id) || !str(o.title, 160) || !str(o.thesis, 3000) || !str(o.rationale, 6000) || !str(o.risk, 3000) || !str(o.preview, 512)) return invalid("Incomplete or duplicate design option");
    if (paths.has(o.preview)) return invalid("Each showcase option needs its own preview");
    paths.add(o.preview);
    ids.add(o.id);
    return { id: o.id, title: o.title, thesis: o.thesis, rationale: o.rationale, risk: o.risk, preview: o.preview };
  });
  return { ...base, phase: value.phase, options };
}

export function parseDesignResponse(v: unknown): DesignResponse {
  if (!obj(v)) return invalid("Design response must be an object");
  if (v.action === "revise" && str(v.note, 6000)) return { action: v.action, note: v.note.trim() };
  if ((v.action === "select" || v.action === "approve") && str(v.optionId, 48)) return { action: v.action, optionId: v.optionId, confirmed: v.confirmed === true };
  if (v.action === "answer" && obj(v.answers) && Object.keys(v.answers).length <= 3 && Object.values(v.answers).every((a) => str(a, 6000)) && (v.stack === "existing" || v.stack === "react-nest" || v.stack === "custom")) {
    const answers: Record<string, string> = {};
    for (const [key, answer] of Object.entries(v.answers)) {
      if (!ID.test(key) || typeof answer !== "string") return invalid("Invalid answer");
      answers[key] = answer.trim();
    }
    if (v.stack === "custom" && !str(v.customStack, 3000)) return invalid("Describe the custom stack");
    return { action: v.action, answers, stack: v.stack, ...(v.stack === "custom" ? { customStack: String(v.customStack).trim() } : {}) };
  }
  return invalid("Invalid design response");
}
