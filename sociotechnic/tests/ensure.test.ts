import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test as nodeTest } from "node:test";
import { testDatabase } from "./pg-fixture.ts";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;

const database = await testDatabase("ensure");
const test = database ? nodeTest : nodeTest.skip;
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "sociotechnic");
const CLI = join(HERE, "..", "src", "cli.ts");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("ui --ensure starts a detached console once and ui --stop stops it", async () => {
  const home = mkdtempSync(join(tmpdir(), "sociotechnic-ensure-"));
  const port = await freePort();
  const env = { ...process.env, SOCIOTECHNIC_HOME: home, SOCIOTECHNIC_DATABASE_URL: database ?? "" };
  const noOpener = join(home, "empty-path");
  mkdirSync(noOpener);
  const parse = (args: string[], r: { status: number | null; stdout: string; stderr: string }): Json => {
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as Json;
  };
  const sociotechnic = (...args: string[]): Json => parse(args, spawnSync(BIN, args, { env, encoding: "utf8", timeout: 20_000 }));
  const sociotechnicNoOpener = (...args: string[]): Json =>
    parse(args, spawnSync(process.execPath, [CLI, ...args], { env: { ...env, PATH: noOpener }, encoding: "utf8", timeout: 20_000 }));
  const pidFile = join(home, ".sociotechnic", "ui.pid");
  let pid: number | null = null;
  try {
    const first = sociotechnic("ui", "--ensure", "--port", String(port), "--no-open");
    assert.equal(first.started, true);
    assert.equal(first.opened, false);
    assert.equal(first.running, true);
    assert.equal(first.port, port);
    assert.equal(first.url, `http://127.0.0.1:${port}/`);
    pid = first.pid as number;
    assert.ok(Number.isInteger(pid) && pid !== process.pid);
    assert.ok(existsSync(pidFile));

    const health = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as Json;
    assert.equal(health.ok, true);
    assert.equal(health.sociotechnicHome, home);
    assert.equal(health.pid, pid);

    const second = sociotechnic("ui", "--ensure", "--port", String(port), "--no-open");
    assert.equal(second.running, true);
    assert.equal(second.started, false);
    assert.equal(second.opened, false);

    const reopened = sociotechnicNoOpener("ui", "--ensure", "--port", String(port), "--open");
    assert.equal(reopened.started, false);
    assert.equal(reopened.opened, true, "an explicit --open opens, and a missing opener never fails");
    assert.equal(sociotechnicNoOpener("ui", "--ensure", "--port", String(port), "--open", "--no-open").opened, false);
    assert.equal(second.pid, pid);

    const stop = sociotechnic("ui", "--stop", "--port", String(port));
    assert.deepEqual(stop, { stopped: true, pid });
    assert.equal(await portOpen(port), false);
    assert.equal(existsSync(pidFile), false);

    assert.deepEqual(sociotechnic("ui", "--stop", "--port", String(port)), { stopped: false, pid: null });
  } finally {
    if (pid === null && existsSync(pidFile)) pid = Number(readFileSync(pidFile, "utf8").trim()) || null;
    if (pid !== null && alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(home, { recursive: true, force: true });
  }
});
