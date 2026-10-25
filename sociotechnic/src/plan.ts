import { createHash } from "node:crypto";
import type { Tier } from "./roles.ts";
import type { Parsed } from "./verdict.ts";

export type Stage = {
  id: string;
  title: string;
  description: string;
  files: string[];
  acceptance: string[];
  risks: string[];
};

export type Plan = {
  agentRecommendations?: { agent: string; reason: string }[];
  designDigest?: string;
  title: string;
  summary: string;
  tier: Tier;
  tierReason: string;
  stages: Stage[];
  acceptance: string[];
  touches: string[];
  docsImpact: { required: boolean; files: string[]; note: string };
  testing: { strategy: string; cases: string[] };
  risks: string[];
  outOfScope: string[];
};

export type PlanParse =
  | { kind: "plan"; plan: Plan; digest: string }
  | { kind: "needs-input"; questions: string[] }
  | { kind: "needs-design"; reason: string }
  | { kind: "needs-research"; questions: string[]; advisors?: (string | null)[] }
  | { kind: "malformed"; errors: string[] };

const TIERS: readonly string[] = ["COMPLEX", "EASY", "BULK", "COMMENTS"];
const STAGE_ID = /^[a-z][a-z0-9-]*$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function planDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

class Checker {
  readonly errors: string[] = [];

  str(o: Obj, key: string, path: string, min = 1, max = Number.POSITIVE_INFINITY): void {
    const v = o[key];
    if (typeof v !== "string") {
      this.errors.push(`${path}${key}: required string`);
    } else if (v.trim().length < min || v.trim().length > max) {
      this.errors.push(`${path}${key}: length must be ${min}..${max === Number.POSITIVE_INFINITY ? "" : max}`);
    }
  }

  strArr(o: Obj, key: string, path: string, min = 0, max = Number.POSITIVE_INFINITY): void {
    const v = o[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim() === "")) {
      this.errors.push(`${path}${key}: required array of non-empty strings`);
    } else if (v.length < min || v.length > max) {
      this.errors.push(`${path}${key}: needs ${min}..${max === Number.POSITIVE_INFINITY ? "" : max} items`);
    }
  }

  obj(o: Obj, key: string, path: string): Obj | null {
    const v = o[key];
    if (!isObj(v)) {
      this.errors.push(`${path}${key}: required object`);
      return null;
    }
    return v;
  }
}

export function validatePlan(raw: unknown): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  if (!isObj(raw)) return { ok: false, errors: ["plan must be a JSON object"] };
  const c = new Checker();
  if (raw.agentRecommendations !== undefined) {
    if (!Array.isArray(raw.agentRecommendations) || raw.agentRecommendations.length > 6) c.errors.push("agentRecommendations: at most six recommendations");
    else {
      const seen = new Set<string>();
      for (const item of raw.agentRecommendations) {
        if (!isObj(item) || typeof item.agent !== "string" || !/^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(item.agent) || seen.has(item.agent) || typeof item.reason !== "string" || item.reason.trim().length < 10 || item.reason.length > 500) c.errors.push("agentRecommendations: use unique registered names and reasons of 10 to 500 characters");
        else seen.add(item.agent);
      }
    }
  }
  c.str(raw, "title", "", 3, 80);
  c.str(raw, "summary", "");
  if (raw.designDigest !== undefined && (typeof raw.designDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.designDigest))) c.errors.push("designDigest: invalid digest");
  if (typeof raw.tier !== "string" || !TIERS.includes(raw.tier)) c.errors.push("tier: must be COMPLEX, EASY, BULK or COMMENTS");
  c.str(raw, "tierReason", "");
  const stages = raw.stages;
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 12) {
    c.errors.push("stages: needs 1..12 stages");
  } else {
    const seen = new Set<string>();
    const owned = new Set<string>();
    stages.forEach((s: unknown, i: number) => {
      const p = `stages[${i}].`;
      if (!isObj(s)) {
        c.errors.push(`stages[${i}]: must be an object`);
        return;
      }
      if (typeof s.id !== "string" || !STAGE_ID.test(s.id)) {
        c.errors.push(`${p}id: must match ${STAGE_ID.source}`);
      } else if (seen.has(s.id)) {
        c.errors.push(`${p}id: duplicate stage id ${s.id}`);
      } else {
        seen.add(s.id);
      }
      c.str(s, "title", p);
      c.str(s, "description", p);
      c.strArr(s, "files", p, raw.tier === "COMMENTS" ? 1 : 0);
      if (raw.tier === "COMMENTS" && Array.isArray(s.files)) {
        for (const file of s.files) {
          if (typeof file !== "string") continue;
          if (file.startsWith("/") || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "." || part === "")) c.errors.push(`${p}files: use repository-relative paths`);
          if (owned.has(file)) c.errors.push(`${p}files: overlapping comment-cleanup ownership: ${file}`);
          owned.add(file);
        }
      }
      c.strArr(s, "acceptance", p, 1);
      c.strArr(s, "risks", p);
    });
  }
  c.strArr(raw, "acceptance", "", 1);
  c.strArr(raw, "touches", "", 1);
  const docs = c.obj(raw, "docsImpact", "");
  if (docs !== null) {
    if (typeof docs.required !== "boolean") c.errors.push("docsImpact.required: required boolean");
    c.strArr(docs, "files", "docsImpact.");
    if (typeof docs.note !== "string") c.errors.push("docsImpact.note: required string");
  }
  const testing = c.obj(raw, "testing", "");
  if (testing !== null) {
    c.str(testing, "strategy", "testing.");
    c.strArr(testing, "cases", "testing.");
  }
  c.strArr(raw, "risks", "");
  c.strArr(raw, "outOfScope", "");
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, plan: raw as unknown as Plan };
}

export function parsePlanText(text: string | null, researchUsed: boolean, _designUsed = false): PlanParse {
  if (text === null) return { kind: "malformed", errors: ["plan.json is missing"] };
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { kind: "malformed", errors: ["plan.json is not valid JSON"] };
  }
  if (isObj(raw) && raw.status === "needs-input") {
    const questions = raw.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 6) return { kind: "malformed", errors: ["questions: needs 1..6 questions"] };
    const parsed: string[] = [];
    for (const question of questions) {
      if (typeof question !== "string" || !question.trim() || question.length > 4000) return { kind: "malformed", errors: ["questions: each must be a nonempty string of at most 4000 characters"] };
      parsed.push(question.trim());
    }
    return { kind: "needs-input", questions: parsed };
  }
  if (isObj(raw) && raw.status === "needs-design") {
    if (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 4000) return { kind: "malformed", errors: ["needs-design requires a specific assignment reason"] };
    return { kind: "needs-design", reason: raw.reason.trim() };
  }
  if (isObj(raw) && raw.status === "needs-research") {
    if (researchUsed) return { kind: "malformed", errors: ["needs-research is allowed once per job and was already used"] };
    const q = raw.questions;
    if (!Array.isArray(q) || q.length < 1 || q.length > 6 || q.some((x) => typeof x !== "string" || x.trim() === "")) {
      return { kind: "malformed", errors: ["questions: needs 1..6 non-empty strings"] };
    }
    const advisors = raw.advisors;
    let selected: (string | null)[] | undefined;
    if (advisors !== undefined) {
      if (!Array.isArray(advisors) || advisors.length !== q.length) return { kind: "malformed", errors: ["advisors: use one registered researcher name or null per question"] };
      selected = [];
      for (const name of advisors) {
        if (name === null || (typeof name === 'string' && /^sociotechnic-[a-z][a-z0-9-]{2,59}$/.test(name))) selected.push(name);
        else return { kind: "malformed", errors: ["advisors: use one registered researcher name or null per question"] };
      }
    }
    return { kind: "needs-research", questions: q as string[], ...(selected === undefined ? {} : { advisors: selected }) };
  }
  const v = validatePlan(raw);
  if (!v.ok) return { kind: "malformed", errors: v.errors };
  return { kind: "plan", plan: v.plan, digest: planDigest(raw) };
}

export function planParsed(p: PlanParse): Parsed {
  const base = { commit: null, findings: [], blocking: 0 };
  if (p.kind === "malformed") return { ...base, kind: "malformed", value: null, reason: p.errors.join("; "), effective: "BLOCKED" };
  return { ...base, kind: "ok", value: p.kind, reason: null, effective: "DONE" };
}
