import { catalogEntry } from "./agent-catalog.ts";
import type { AgentConfiguration } from "./agent-catalog.ts";
import { canonicalJson, isAgentVersion, supportsAgentSlot } from "./agent-version-data.ts";
import { agentBase, readAgentVersion } from "./agent-versions.ts";
import { agentCard } from "./agent-roster.ts";
import { SociotechnicError } from "./errors.ts";
import type { Job } from "./job.ts";
import { ROLES } from "./roles.ts";

export type WorkflowResourceChoice = { slot: string; agent: string; version: string };

function invalid(field: string, message: string, code = "bad-agent-selection"): never {
  throw new SociotechnicError(code, `${field}: ${message}`);
}

export async function resolveWorkflowSelections(job: Job, choices: readonly WorkflowResourceChoice[], allowedSlots: readonly string[]): Promise<Record<string, AgentConfiguration>> {
  if (!Array.isArray(choices)) invalid("selections", "Expected an array of resource selections");
  const seen = new Set<string>();
  const selected: [string, AgentConfiguration][] = [];
  for (const [index, choice] of choices.entries()) {
    const field = `selections[${index}]`;
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) invalid(field, "Expected a resource selection object");
    for (const key of Object.keys(choice)) {
      if (!["slot", "agent", "version"].includes(key)) invalid(`${field}.${key}`, "Selections contain only slot, agent and version; execution settings come from the immutable release");
    }
    if (typeof choice.slot !== "string" || !ROLES.some((role) => role.name === choice.slot) || !allowedSlots.includes(choice.slot)) invalid(`${field}.slot`, "Unknown or unavailable workflow role slot");
    if (choice.slot === "sociotechnic-comment-sicko") invalid(`${field}.slot`, "Nested comment workers cannot be selected by a workflow");
    if (seen.has(choice.slot)) invalid(`${field}.slot`, `Duplicate selection for ${choice.slot}`);
    seen.add(choice.slot);
    if (typeof choice.agent !== "string" || !choice.agent) invalid(`${field}.agent`, "An exact roster agent name is required");
    if (choice.agent === "sociotechnic-comment-sicko") invalid(`${field}.agent`, "Nested comment workers cannot be selected by a workflow");
    if (!isAgentVersion(choice.version)) invalid(`${field}.version`, "An exact semantic release version is required");
    const locked=job.agentConfigurations?.[choice.slot];
    if(job.agentLocks?.includes(choice.slot)&&locked){
      if((locked.agentName??choice.slot)!==choice.agent||locked.version!==choice.version)invalid(field,"Explicit user assignment/version is locked");
      selected.push([choice.slot,structuredClone(locked)]);continue;
    }
    const cards = job.agentRoster?.filter((card) => card.name === choice.agent) ?? [];
    if (cards.length !== 1) invalid(`${field}.agent`, "Agent must have exactly one capability card in this run's frozen roster");
    const card = cards[0];
    if (card.version !== choice.version) invalid(`${field}.version`, `The frozen roster lists ${choice.agent} v${card.version}`);

    const current = job.agentConfigurations?.[choice.slot];
    if (job.agentLocks?.includes(choice.slot)) {
      const name = current?.agentName ?? job.agentAssignments?.[choice.slot] ?? choice.slot;
      const version = current?.version ?? job.agentVersions?.[choice.slot];
      if (choice.agent !== name) invalid(`${field}.agent`, `The explicit assignment for ${choice.slot} is locked to ${name}; omit this selection to retain it`);
      if (choice.version !== version) invalid(`${field}.version`, `The explicit version for ${choice.slot} is locked to ${version ?? "an unrecorded release"}; omit this selection to retain it`);
    }

    const release = await (async () => {
      try { return await readAgentVersion(await agentBase(choice.agent), choice.version); }
      catch (error) {
        if (error instanceof SociotechnicError) invalid(`${field}.version`, error.message, error.code);
        throw error;
      }
    })();
    if (!supportsAgentSlot(release, choice.slot)) invalid(`${field}.agent`, `${choice.agent} cannot fill role ${choice.slot}`);
    if (canonicalJson(card) !== canonicalJson(agentCard(catalogEntry(release)))) invalid(`${field}.agent`, "The capability card differs from its immutable database release", "agent-version-conflict");
    const configuration = catalogEntry(release, choice.slot).configuration;
    if (job.agentLocks?.includes(choice.slot) && current) {
      const { releaseDigest: _currentDigest, ...pinned } = current;
      const { releaseDigest: _releaseDigest, ...resolved } = configuration;
      if (canonicalJson(pinned) !== canonicalJson(resolved) || (current.releaseDigest !== undefined && current.releaseDigest !== configuration.releaseDigest)) invalid(`${field}.agent`, "The locked configuration differs from its immutable database release", "agent-version-conflict");
    }
    selected.push([choice.slot, configuration]);
  }
  return Object.fromEntries(selected);
}
