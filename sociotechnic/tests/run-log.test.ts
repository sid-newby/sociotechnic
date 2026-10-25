import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunLogBuffer } from "../ui/web/src/run-log.ts";
import { catchUpRunLog, mergeRunLog } from "../ui/web/src/run-log.ts";

const line = (seq: number) => ({ seq, at: "2026-10-25T15:37:00Z", level: "info", dispatchId: "d-001", line: String(seq) });

test("catch-up merged with overlapping live events renders each sequence once", async () => {
  const caught = await catchUpRunLog(async () => ({ entries: [line(2), line(1), line(2)], first: 1, more: false }), new AbortController().signal);
  const merged = mergeRunLog(caught, [line(2), line(3), line(3)]);
  assert.deepEqual(merged.lines.map((entry) => entry.seq), [1, 2, 3]);
  assert.equal(merged.dropped, false);
});

test("catch-up reaches beyond ten pages and keeps only the latest 5000 lines", async () => {
  const cursors: number[] = [];
  const log = await catchUpRunLog(async (after) => {
    cursors.push(after);
    const entries = Array.from({ length: Math.min(1000, 12050 - after) }, (_, i) => line(after + i + 1));
    return { entries, first: 1, more: after + entries.length < 12050 };
  }, new AbortController().signal);
  assert.equal(cursors.length, 13);
  assert.equal(cursors.at(-1), 12000);
  assert.equal(log.lines.length, 5000);
  assert.equal(log.lines[0].seq, 7051);
  assert.equal(log.lines.at(-1)?.seq, 12050);
  assert.equal(log.dropped, true);
});

test("server retention gaps are disclosed even when the retained tail fits", async () => {
  const log = await catchUpRunLog(async () => ({ entries: [line(55), line(56)], first: 55, more: false }), new AbortController().signal);
  assert.equal(log.dropped, true);
  assert.deepEqual(log.lines.map((entry) => entry.seq), [55, 56]);
});

test("buffer remains bounded during long live catch-up and preserves deduplication", () => {
  let pending: RunLogBuffer = { lines: [line(1)], dropped: false };
  for (let first = 2; first <= 12000; first += 1000) {
    pending = mergeRunLog(pending, Array.from({ length: 1000 }, (_, i) => line(first + i)));
    assert.ok(pending.lines.length <= 5000);
  }
  assert.equal(pending.lines.at(-1)?.seq, 12001);
  assert.equal(pending.dropped, true);
  const overlap = mergeRunLog(pending, [line(12001)]);
  assert.equal(overlap.lines.length, 5000);
});

test("cancellation while a request is in flight prevents another page", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(catchUpRunLog(async () => {
    requests += 1;
    controller.abort();
    return { entries: [line(1)], more: true };
  }, controller.signal), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("an already cancelled load does not issue a request", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(catchUpRunLog(async () => { requests += 1; return {}; }, controller.signal), { name: "AbortError" });
  assert.equal(requests, 0);
});

test("request errors and non-advancing pages fail visibly instead of silently truncating", async () => {
  await assert.rejects(catchUpRunLog(async () => { throw new Error("offline"); }, new AbortController().signal), /offline/);
  let requests = 0;
  await assert.rejects(catchUpRunLog(async () => {
    requests += 1;
    return { entries: [line(1)], more: true };
  }, new AbortController().signal), /did not advance/);
  assert.equal(requests, 2);
});
