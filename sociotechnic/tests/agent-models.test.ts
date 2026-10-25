import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CODEX_MODELS, supportsCodex } from "../src/agent-models.ts";
import { catalogEntry } from "../src/agent-catalog.ts";
import { modelChoices, parseAgentVersion, versionRole } from "../src/agent-version-data.ts";
import { agentBase, createAgent, initializeAgentVersions, listAgentVersions, pinAgentVersions, publishAgentVersion, readAgentVersion } from "../src/agent-versions.ts";
import { createMemoryStore, setStore } from "../src/db/store.ts";
import { ROLES, roleOf } from "../src/roles.ts";
import { agentTools } from "../ui/web/src/model.ts";

const root = mkdtempSync(join(tmpdir(), "sociotechnic-models-"));
process.env.SOCIOTECHNIC_HOME = root;
process.env.SOCIOTECHNIC_DATABASE_URL = "off";
const store = createMemoryStore();
setStore(store);
before(() => initializeAgentVersions(store, [], []));
after(() => { setStore(null); rmSync(root, { recursive: true, force: true }); });

test("model choices and validation allow provider changes only on compatible reader and ordinary builder templates", () => {
  for (const base of ROLES) {
    assert.ok(modelChoices(base).includes("sonnet"));
    for (const model of CODEX_MODELS) {
      const draft = { ...base, model, effort: "high" };
      if (!supportsCodex(base)) {
        assert.equal(modelChoices(base).includes(model), false);
        assert.throws(() => versionRole(base, draft), /compatible reader or ordinary builder template/);
        assert.throws(() => versionRole(base, { ...draft, tools: ["Read", "Grep", "Glob", "Write"] }));
        continue;
      }
      assert.ok(modelChoices(base).includes(model));
      const role = versionRole(base, draft);
      assert.equal(role.provider, "codex"); assert.equal(role.model, model);
      assert.equal(role.record, base.record); assert.deepEqual(role.tools, base.tools);
      assert.throws(() => versionRole(base, { ...draft, effort: "xhigh" }), /Unsupported effort/);
      const claude = versionRole(base, { ...draft, model: "sonnet", effort: "xhigh" });
      assert.equal(claude.provider, "claude"); assert.equal("claudeModel" in claude, false);
    }
  }
  const security = roleOf("sociotechnic-reviewer-security");
  assert.deepEqual(agentTools("codex", security.tools), ["read_file", "glob", "grep", "web_search"]);
});

test("existing agents publish either provider and preserve legacy releases and pinned settings", async () => {
  const base = roleOf("sociotechnic-reviewer-ux");
  const baseline = await readAgentVersion(base, "1.0.0");
  const release = await publishAgentVersion(base, { ...base, model: "gpt-6-astra", effort: "high", version: "1.1.0", expectedLatest: "1.0.0", label: "Try OpenAI review" });
  assert.deepEqual(parseAgentVersion(base, release), release);
  assert.equal(catalogEntry(release).configuration.provider, "codex");
  const pins = await pinAgentVersions();
  assert.equal(pins.configurations[base.name].provider, "codex");
  assert.equal(pins.configurations[base.name].model, "gpt-6-astra");
  await publishAgentVersion(base, { ...base, model: "sonnet", version: "1.2.0", expectedLatest: "1.1.0", label: "Return to Claude" });
  assert.equal(pins.configurations[base.name].provider, "codex");
  assert.equal((await readAgentVersion(base, "1.2.0")).role.provider, "claude");
  assert.deepEqual(await readAgentVersion(base, "1.0.0"), baseline);
  const codexBase = roleOf("sociotechnic-reviewer-code");
  const switched = await publishAgentVersion(codexBase, { ...codexBase, model: "opus", effort: "xhigh", version: "1.1.0", expectedLatest: "1.0.0", label: "Try Claude review" });
  assert.equal((await readAgentVersion(codexBase, switched.version)).role.provider, "claude");
});

test("new custom reader identities can start on Codex and later switch provider", async () => {
  const base = roleOf("sociotechnic-planner"), name = "sociotechnic-openai-planner";
  const release = await createAgent({ ...base, name, template: base.name, model: "gpt-6-sol", effort: "high", purpose: "Plan migrations with restore verification.", instructions: "Read the schema and plan each migration with rollback and restore verification. Return the required complete plan.json record.", distinctPurpose: "Focuses on migration rollback and restoration checks for the schema.", reviewedAgents: [`${base.name}@1.0.0`] });
  const custom = await agentBase(name);
  assert.equal(release.role.provider, "codex");
  assert.equal((await listAgentVersions(custom)).models.includes("gpt-6-sol"), true);
  assert.equal((await readAgentVersion(custom, "1.0.0")).role.provider, "codex");
  const pins = await pinAgentVersions({}, undefined, { [base.name]: name });
  assert.equal(pins.configurations[base.name].baseRole, base.name);
  assert.equal(pins.configurations[base.name].provider, "codex");
  await publishAgentVersion(custom, { ...base, model: "sonnet", version: "1.1.0", expectedLatest: "1.0.0", label: "Try Claude planning" });
  assert.equal((await readAgentVersion(custom, "1.1.0")).role.provider, "claude");
  assert.equal(pins.configurations[base.name].model, "gpt-6-sol");
});
