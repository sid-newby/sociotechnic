import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { request } from "../api";
import { object, text } from "../model";
import { BadgeCheck, Bot, Braces, BrushCleaning, Compass, DraftingCompass, Feather, Fingerprint, Hammer, ListChecks, Microscope, Paintbrush, ShieldCheck, Sparkles, Waypoints } from "lucide-react";

const identities = {
  "sociotechnic-designer": { label: "Designer", icon: Paintbrush, when: "When a run needs a design interview, directions or composition approval." },
  "sociotechnic-planner": { label: "Planner", icon: Compass, when: "At the start of a feature run, after research, or after design approval to pin the implementation plan." },
  "sociotechnic-researcher": { label: "Researcher", icon: Microscope, when: "When the planner requests a bounded research question before pinning a plan." },
  "sociotechnic-builder": { label: "Builder", icon: Hammer, when: "For COMPLEX plans and subsequent build rounds in that tier." },
  "sociotechnic-builder-lite": { label: "Builder lite", icon: Feather, when: "For EASY plans with localized implementation work." },
  "sociotechnic-comment-cleaner": { label: "Comment coordinator", icon: Waypoints, when: "For COMMENTS plans, coordinating bounded cleanup and verification workers." },
  "sociotechnic-comment-sicko": { label: "Comment Sicko", icon: BrushCleaning, when: "As a nested worker assigned by the comment coordinator. Worker calls are not separate engine deployments." },
  "sociotechnic-sweeper": { label: "Sweeper", icon: Sparkles, when: "For BULK plans with mechanical changes across files." },
  "sociotechnic-reviewer-code": { label: "Code reviewer", icon: Braces, when: "After a build and checks, when the code lens matches changed files." },
  "sociotechnic-reviewer-ux": { label: "UX reviewer", icon: Fingerprint, when: "After a build and checks, when the UX lens matches changed files." },
  "sociotechnic-reviewer-ui": { label: "UI reviewer", icon: DraftingCompass, when: "After a build and checks, when the UI lens matches changed files." },
  "sociotechnic-reviewer-security": { label: "Security reviewer", icon: ShieldCheck, when: "After a build and checks, when the security lens matches changed files." },
  "sociotechnic-conformance": { label: "Conformance", icon: ListChecks, when: "During review to compare implementation with the pinned plan." },
  "sociotechnic-approver": { label: "Approver", icon: BadgeCheck, when: "After a passing gate with no policy flags, before the human decides." },
};
function identity(name: string) { return Object.entries(identities).find(([key]) => key === name)?.[1]; }
export const agentLabel = (name: string) => identity(name)?.label ?? name.replace(/^sociotechnic-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
export const agentWhen = (name: string) => identity(name)?.when ?? "Historical role; no current dispatch rule is configured.";
const AgentTemplates = createContext<Readonly<Record<string, string>>>({});
export function AgentIdentityProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<Record<string, string>>({}), [revision, setRevision] = useState(0);
  useEffect(() => { const refresh = () => setRevision((v) => v + 1); window.addEventListener("agent-catalog-updated", refresh); return () => window.removeEventListener("agent-catalog-updated", refresh); }, []);
  useEffect(() => {
    const abort = new AbortController();
    request("/api/agent-versions", abort.signal).then((value) => { const agents = object(value).agents; if (!Array.isArray(agents)) throw new Error("Invalid agent identities"); return Object.fromEntries(agents.map((v) => { const a = object(v); return [text(a.name), text(a.template)]; })); }).then((value) => { if (!abort.signal.aborted) setTemplates(value); }).catch(() => {});
    return () => abort.abort();
  }, [revision]);
  return <AgentTemplates.Provider value={templates}>{children}</AgentTemplates.Provider>;
}
export function AgentIcon({ name, size = 20 }: { name: string; size?: number }) {
  const templates = useContext(AgentTemplates), template = templates[name] ?? name;
  const Icon = identity(template)?.icon ?? Bot;
  return <Icon className={`agent-icon agent-color-${template.replace(/^sociotechnic-/, "")}`} size={size} aria-hidden="true" />;
}
export function AgentName({ name, version = "1.0.0" }: { name: string; version?: string | null }) {
  const templates = useContext(AgentTemplates), template = templates[name] ?? name;
  return <span className={`agent-name agent-color-${template.replace(/^sociotechnic-/, "")}`}>{agentLabel(name)} <span className="agent-version">{version ? `v${version}` : "version unrecorded"}</span></span>;
}
