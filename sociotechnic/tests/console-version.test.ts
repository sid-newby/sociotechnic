import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { entries } from "../../.github/scripts/changelog.cjs";
import { resolveConfig } from "../ui/web/node_modules/vite/dist/node/index.js";

test("Vite embeds the release parser's newest changelog version in the console", async () => {
  const root = fileURLToPath(new URL("../ui/web", import.meta.url));
  const config = await resolveConfig({ root }, "build");
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  assert.ok(config.define, "Vite must define the console version");
  assert.equal(config.define.__APP_VERSION__, JSON.stringify(entries(changelog)[0].tag));
});
