import { agentCatalogEntry } from "../../src/agent-catalog.ts";
import type { OrchestratorBinding } from "../../src/orchestrator.ts";
import { roleOf } from "../../src/roles.ts";

export function binding(review: OrchestratorBinding["review"]): OrchestratorBinding {
  return { agent: "sociotechnic-orchestrator", configuration: { ...agentCatalogEntry(roleOf("sociotechnic-reviewer-code")).configuration, baseRole: "sociotechnic-reviewer-code", tools: ["Read","Grep","Glob","Write"], definition: "---\ndescription: Supervise contracted handoffs\n---\nAssess the supplied work and evidence. Use the referenced response contract.\n" }, review };
}
