import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { configuredTestDatabaseUrl, postgresEnvironment } from "./fixtures/postgres-environment.ts";

test("dump/restore environment binds an explicit Unix socket and port without ambient fallback", () => {
  const saved = { PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT, PGSERVICE: process.env.PGSERVICE, PGSERVICEFILE: process.env.PGSERVICEFILE, PGHOSTADDR: process.env.PGHOSTADDR };
  process.env.PGHOST = "live.invalid";
  process.env.PGPORT = "5433";
  process.env.PGSERVICE = "operator-service";
  process.env.PGSERVICEFILE = "/unrelated/operator-services.conf";
  process.env.PGHOSTADDR = "192.0.2.1";
  try {
    const env = postgresEnvironment("postgresql:///sociotechnic_test_fixture?host=%2Ftmp%2Fsociotechnic-flow-pg-20261025&port=55439");
    assert.equal(env.PGHOST, "/tmp/sociotechnic-flow-pg-20261025");
    assert.equal(env.PGPORT, "55439");
    assert.equal(env.PGDATABASE, "sociotechnic_test_fixture");
    assert.equal(env.PGSERVICE, undefined);
    assert.equal(env.PGSERVICEFILE, undefined);
    assert.equal(env.PGHOSTADDR, undefined);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("dump/restore environment keeps TCP credentials and query endpoint precedence", () => {
  const env = postgresEnvironment("postgresql://fixture%20user:fixture%20password@unused.invalid:9999/test%20db?host=%2Ftmp%2Fowned&port=55439");
  assert.equal(env.PGHOST, "/tmp/owned");
  assert.equal(env.PGPORT, "55439");
  assert.equal(env.PGUSER, "fixture user");
  assert.equal(env.PGPASSWORD, "fixture password");
  assert.equal(env.PGDATABASE, "test db");
  const tcp = postgresEnvironment("postgresql://fixture@localhost:6543/test");
  assert.equal(tcp.PGHOST, "localhost");
  assert.equal(tcp.PGPORT, "6543");
});

for (const url of [
  "postgresql:///postgres?port=55439",
  "postgresql:///postgres?host=&port=55439",
  "postgresql://localhost/postgres",
  "postgresql://%20:55439/postgres",
  "postgresql://localhost:55439/postgres?port=",
  "postgresql://localhost/postgres?port=invalid",
  "postgresql://localhost/postgres?port=0",
  "postgresql://localhost/postgres?port=65536",
  "postgresql://localhost/postgres?port=54.3",
  "https://localhost:55439/postgres",
  "postgresql:///postgres?host=%2Ftmp%2Fowned&port=55439&host=",
  "postgresql:///postgres?host=&host=%2Ftmp%2Fowned&port=55439",
  "postgresql:///postgres?host=%2Ftmp%2Fowned&port=55439&port=",
  "postgresql:///postgres?host=%2Ftmp%2Fowned&port=&port=55439",
  "",
]) test(`configured test endpoint rejects default/invalid connection: ${url}`, () => {
  assert.throws(() => configuredTestDatabaseUrl(url));
  assert.throws(() => postgresEnvironment(url));
});

test("only an absent test opt-in skips; explicit malformed endpoint fails closed", () => {
  assert.equal(configuredTestDatabaseUrl(undefined), null);
  assert.throws(() => configuredTestDatabaseUrl("postgresql:///postgres?port=55439"), /explicit nonempty host and valid explicit port/);
});

test("database fixture rejects an incomplete endpoint before reaching the connection boundary", () => {
  const script = `const { testDatabase } = await import(${JSON.stringify(new URL("./pg-fixture.ts", import.meta.url).href)}); await testDatabase("invalid_endpoint");`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, SOCIOTECHNIC_DATABASE_URL: "off", SOCIOTECHNIC_TEST_DATABASE_URL: "postgresql:///postgres?port=55439" },
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /explicit nonempty host and valid explicit port/);
  assert.doesNotMatch(child.stderr, /ECONNREFUSED|ENOTFOUND|connect ECONN/);
});

test("dump/restore decodes a socket supplied in the URL hostname", () => {
  const env = postgresEnvironment("postgresql://%2Ftmp%2Fowned:55439/postgres");
  assert.equal(env.PGHOST, "/tmp/owned");
  assert.equal(env.PGPORT, "55439");
});
