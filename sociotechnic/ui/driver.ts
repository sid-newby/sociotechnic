import { runInteractiveDesign } from "./design-session-runner.ts";
import type { DesignQuery } from "./design-session-runner.ts";
import { versionRole } from "../src/agent-versions.ts";

import type { DispatchOut, StepResult } from "../src/engine.ts";
import { mutateJob, readJob, effectJob } from "../src/job-store.ts";
export { mutateJob } from "../src/job-store.ts";
import { prepareDispatch, ingestDispatch, stagedRecord } from "../src/staging.ts";
import { finish, interrupt as recordInterrupt, step, statusLine } from "../src/engine.ts";
import { acquireDriver, releaseDriver, verifyDriverLease } from "../src/driverlock.ts";
import type { DriverOwner } from "../src/driverlock.ts";
import { IllegalTransition, SociotechnicError } from "../src/errors.ts";
import type { Job, Status } from "../src/job.ts";
import { localDispatchLimit } from "../src/local-capacity.ts";
import { session } from "../src/record-store.ts";


import { restoreWorktree } from "../src/db/restore.ts";
import { assertJobId, sociotechnicHome } from "../src/paths.ts";
import { roleOf } from "../src/roles.ts";
import { removeSandboxDispatch, stopSandbox } from "../src/sandbox.ts";
import { nowIso } from "../src/time.ts";
import type { RunResult, Runner } from "./runner.ts";

export type DriverMode = "run" | "step" | "conversation";
export type LogLevel = "info" | "warn" | "error";
export type LogEntry = { seq: number; at: string; level: LogLevel; text: string; dispatchId: string | null };
export type LogEvent = { jobId: string; dispatchId: string | null; seq: number; at: string; level: LogLevel; line: string };
export type LogPage = { job: string; entries: Omit<LogEvent, "jobId">[]; first: number | null; last: number | null; more: boolean };
export type ActiveDispatch = { dispatchId: string; agent: string; startedAt: string; deadlineAt: string; lastActivity: string | null };
export type InterruptOutcome = { job: string; dispatch: string; outcome: "interrupted"; note: string | null; terminated: boolean };

export type DriverState = {
  running: boolean;
  mode: DriverMode | null;
  hold: string[];
  startedAt: string | null;
  finishedAt: string | null;
  active: ActiveDispatch[];
  queued: string[];
  log: LogEntry[];
  lastStep: StepResult | null;
  error: string | null;
};

export type LifecycleEvent = "started" | "step" | "dispatch-started" | "dispatch-finished" | "paused" | "stopped" | "error";
export type DriverEvent = { id: string; event: string } & Record<string, unknown>;

export type DriverRegistry = {
  state: (id: string) => DriverState;
  isRunning: (id: string) => boolean;
  run: (id: string, mode: DriverMode, hold: readonly Status[]) => Promise<DriverState>;
  pause: (id: string) => DriverState;
  stop: (id: string) => DriverState;
  interrupt: (id: string, dispatchId: string, note: string | null) => Promise<InterruptOutcome> | null;
  logPage: (id: string, after: number, limit: number) => LogPage;
  capacity: () => { running: number; queued: number };
  capacityChanged: () => void;
  settled: (id: string) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type DriverOptions = { runner: () => Runner; emit: (event: DriverEvent) => void; onLog?: (event: LogEvent) => void; owner?: DriverOwner; consoleUrl?: () => string; designQuery?: DesignQuery };

const LOG_TAIL = 200;
const LOG_BYTES = 1024 * 1024;
const LINE_BYTES = 8 * 1024;
const ACTIVITY_INTERVAL_MS = 250;
const QUEUE_RECHECK_MS = 1000;
const QUEUED_DEADLINE_NOTE = "deadline reached while waiting for a local dispatch slot";

function emptyState(): Omit<DriverState, "log"> {
  return { running: false, mode: null, hold: [], startedAt: null, finishedAt: null, active: [], queued: [], lastStep: null, error: null };
}

type Control = { abort: AbortController; interrupt: { note: string | null } | null; started: boolean; recording: boolean; terminated: boolean; done: Promise<void>; settle: () => void; fail: (error: unknown) => void };

type Slot = {
  id: string;
  state: Omit<DriverState, "log">;
  pauseRequested: boolean;
  token: string;
  abort: AbortController;
  loop: Promise<void>;
  activity: Map<string, { last: number; timer: NodeJS.Timeout | null; pending: LogEntry[] }>;
  controls: Map<string, Control>;
  log: LogEntry[];
  logStart: number;
  logBytes: number;
  seq: number;
};

function roundOf(record: string): number {
  const m = /^round-(\d+)\//.exec(record);
  return m === null ? 0 : Number(m[1]);
}

function snapshot(slot: Slot): DriverState {
  const { state } = slot;
  return { ...state, hold: [...state.hold], active: state.active.map((a) => ({ ...a })), queued: [...state.queued], log: slot.log.slice(Math.max(slot.logStart, slot.log.length - LOG_TAIL)) };
}

function clip(text: string): string {
  if (Buffer.byteLength(text) <= LINE_BYTES) return text;
  return `${Buffer.from(text).subarray(0, LINE_BYTES - 3).toString("utf8").replace(/�$/, "")}…`;
}

function track(slot: Slot, dispatchId: string): Control {
  let settle = (): void => undefined;
  let fail = (_error: unknown): void => undefined;
  const done = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
  done.catch(() => undefined);
  const control: Control = { abort: new AbortController(), interrupt: null, started: false, recording: false, terminated: false, done, settle: () => settle(), fail: (error) => fail(error) };
  slot.controls.set(dispatchId, control);
  return control;
}

export function createDriverRegistry(options: DriverOptions): DriverRegistry {
  const slots = new Map<string, Slot>();
  const owner = options.owner ?? "ui";
  const pool = { running: 0, queue: [] as symbol[], waiters: new Set<() => void>() };

  const slotOf = (id: string): Slot => {
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = { id, state: emptyState(), pauseRequested: false, token: "", abort: new AbortController(), loop: Promise.resolve(), activity: new Map(), controls: new Map(), log: [], logStart: 0, logBytes: 0, seq: 0 };
      slots.set(id, slot);
    }
    return slot;
  };

  const log = (slot: Slot, level: LogLevel, text: string, dispatchId: string | null = null): LogEntry => {
    const line = clip(text);
    const entry: LogEntry = { seq: ++slot.seq, at: nowIso(), level, text: line, dispatchId };
    slot.log.push(entry);
    slot.logBytes += Buffer.byteLength(line);
    while (slot.logBytes > LOG_BYTES && slot.log.length - slot.logStart > 1) slot.logBytes -= Buffer.byteLength(slot.log[slot.logStart++].text);
    if (slot.logStart > 4096 && slot.logStart * 2 > slot.log.length) {
      slot.log = slot.log.slice(slot.logStart);
      slot.logStart = 0;
    }
    options.onLog?.({ jobId: slot.id, dispatchId, seq: entry.seq, at: entry.at, level, line });
    return entry;
  };

  const lifecycle = (id: string, slot: Slot, event: LifecycleEvent): void => {
    options.emit({ id, event, state: snapshot(slot) });
  };

  const flushActivity = (id: string, dispatchId: string, slot: Slot): void => {
    const a = slot.activity.get(dispatchId);
    if (a === undefined || a.pending.length === 0) return;
    options.emit({ id, event: "activity", active: slot.state.active.map((x) => ({ ...x })), log: a.pending });
    a.pending = [];
    a.last = Date.now();
    a.timer = null;
  };

  const activity = (id: string, slot: Slot, dispatchId: string, line: string): void => {
    const entry = log(slot, "info", line, dispatchId);
    const active = slot.state.active.find((x) => x.dispatchId === dispatchId);
    if (active !== undefined) active.lastActivity = line;
    const a = slot.activity.get(dispatchId) ?? { last: 0, timer: null, pending: [] };
    slot.activity.set(dispatchId, a);
    a.pending.push(entry);
    if (a.timer !== null) return;
    const wait = a.last + ACTIVITY_INTERVAL_MS - Date.now();
    if (wait <= 0) flushActivity(id, dispatchId, slot);
    else a.timer = setTimeout(() => flushActivity(id, dispatchId, slot), wait);
  };

  const wake = (): void => { for (const done of [...pool.waiters]) done(); };
  const releaseLocal = (): void => { pool.running -= 1; wake(); };
  const waitForSlot = (signal: AbortSignal, deadlineAt: string): Promise<void> => new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); signal.removeEventListener("abort", done); pool.waiters.delete(done); resolve(); };
    const timer = setTimeout(done, Math.max(0, Math.min(QUEUE_RECHECK_MS, Date.parse(deadlineAt) - Date.now())));
    signal.addEventListener("abort", done, { once: true });
    pool.waiters.add(done);
  });

  const admit = async (slot: Slot, entry: DispatchOut, signal: AbortSignal): Promise<"acquired" | "aborted" | "deadline"> => {
    const ticket = Symbol(entry.id);
    let queued = false;
    try {
      for (;;) {
        const limit = localDispatchLimit();
        if ((pool.queue.length === 0 || pool.queue[0] === ticket) && (limit === null || pool.running < limit)) {
          pool.running += 1;
          return "acquired";
        }
        if (!queued) {
          queued = true;
          pool.queue.push(ticket);
          slot.state.queued.push(entry.id);
          log(slot, "info", `${entry.id} ${entry.agent} queued for a local dispatch slot${limit === null ? "" : ` (limit ${limit})`}`, entry.id);
          continue;
        }
        if (signal.aborted) return "aborted";
        if (Date.parse(entry.deadlineAt) <= Date.now()) return "deadline";
        await waitForSlot(signal, entry.deadlineAt);
      }
    } finally {
      if (queued) {
        pool.queue.splice(pool.queue.indexOf(ticket), 1);
        slot.state.queued = slot.state.queued.filter((x) => x !== entry.id);
        wake();
      }
    }
  };

  const unlaunched = async (id: string, slot: Slot, entry: DispatchOut, control: Control, reason: "aborted" | "deadline"): Promise<void> => {
    if (reason === "aborted" && control.interrupt === null) {
      log(slot, "info", `${entry.id} ${entry.agent} was not launched; it stays pending for the next run`, entry.id);
      return;
    }
    control.recording = true;
    const note = control.interrupt?.note ?? null;
    await mutateJob(id, async (job) => {
      (session().commitGuards ??= []).push(() => verifyDriverLease(id, slot.token));
      await verifyDriverLease(id, slot.token);
      if (reason === "aborted") {
        recordInterrupt(job, entry.id, note);
        return;
      }
      finish(job, entry.id, "timeout", null, QUEUED_DEADLINE_NOTE);
      const d = job.dispatches.find((x) => x.id === entry.id);
      if (d?.execution) d.execution.launch = "finished";
    });
    log(slot, "warn", reason === "aborted" ? `${entry.id} ${entry.agent} interrupted before launch${note === null ? "" : ` (${note})`}` : `${entry.id} ${entry.agent} timeout; ${QUEUED_DEADLINE_NOTE}`, entry.id);
    lifecycle(id, slot, "dispatch-finished");
  };

  const launch = async (id: string, slot: Slot, runner: Runner, entry: DispatchOut, job: Job, control: Control, signal: AbortSignal): Promise<void> => {
    const baseRole = roleOf(entry.configuration?.baseRole ?? entry.agent);
    const role = entry.configuration ? versionRole({ ...baseRole, name: entry.agent }, entry.configuration) : baseRole;
    slot.state.active.push({ dispatchId: entry.id, agent: entry.agent, startedAt: nowIso(), deadlineAt: entry.deadlineAt, lastActivity: null });
    log(slot, "info", `${entry.id} ${entry.agent} ${entry.configuration?.version ? `v${entry.configuration.version}` : "version unrecorded"} started (${entry.model}, ${entry.effort}) -> ${entry.record}`, entry.id);
    lifecycle(id, slot, "dispatch-started");
    const stage = await prepareDispatch(id, entry, slot.token);
    let result: RunResult | null = null;
    if (control.interrupt === null) {
      control.started = true;
      try {
        result = await runner.run(stage.entry, role, {
          sociotechnicHome: sociotechnicHome(),
          execution: job.execution,
          branch: job.branch,
          jobId: id,
          worktree: job.worktree,
          repo: job.repo,
          round: roundOf(entry.record),
          recordPath: stagedRecord(stage),
          inputRoot: stage.inputs,
          outputRoot: stage.outputs,
          signal,
          onActivity: (line) => activity(id, slot, entry.id, line),
          onWarn: (line) => {
            log(slot, "warn", line, entry.id);
          },
        });
      } catch (err) {
        result = { outcome: "failed", usage: null, note: err instanceof Error ? err.message : String(err) };
      }
    }
    control.recording = true;
    const recorded: RunResult = control.interrupt !== null ? { outcome: "interrupted", usage: result?.usage ?? null, note: control.interrupt.note } : result ?? { outcome: "failed", usage: null, note: null };
    const a = slot.activity.get(entry.id);
    if (a !== undefined) {
      if (a.timer !== null) clearTimeout(a.timer);
      a.timer = null;
      flushActivity(id, entry.id, slot);
      slot.activity.delete(entry.id);
    }
    const finished = await ingestDispatch(id, stage, recorded);
    try { await removeSandboxDispatch(job, entry.id); }
    catch { log(slot, "warn", `Sandbox staging for ${entry.id} was retained; committed records are safe in PostgreSQL.`, entry.id); }
    slot.state.active = slot.state.active.filter((x) => x.dispatchId !== entry.id);
    const level = recorded.outcome === "ok" ? "info" : "warn";
    log(slot, level, `${entry.id} ${entry.agent} ${recorded.outcome}; record ${finished.parsed?.effective}${recorded.note === null ? "" : ` (${recorded.note})`}`, entry.id);
    lifecycle(id, slot, "dispatch-finished");
  };

  const execute = async (id: string, slot: Slot, runner: Runner, entry: DispatchOut, job: Job, control: Control): Promise<void> => {
    const signal = AbortSignal.any([slot.abort.signal, control.abort.signal]);
    const local = job.execution?.kind !== "docker-sandbox";
    if (local) {
      const admitted = await admit(slot, entry, signal);
      if (admitted !== "acquired") return unlaunched(id, slot, entry, control, admitted);
      if (control.interrupt !== null) {
        releaseLocal();
        return unlaunched(id, slot, entry, control, "aborted");
      }
    }
    try { await launch(id, slot, runner, entry, job, control, signal); }
    finally { if (local) releaseLocal(); }
  };

  const runOne = async (id: string, slot: Slot, runner: Runner, entry: DispatchOut, job: Job): Promise<void> => {
    const control = slot.controls.get(entry.id) ?? track(slot, entry.id);
    try {
      await execute(id, slot, runner, entry, job, control);
      control.settle();
    } catch (error) {
      control.fail(error);
      throw error;
    } finally {
      if (slot.controls.get(entry.id) === control) slot.controls.delete(entry.id);
    }
  };

  const loop = async (id: string, slot: Slot, mode: DriverMode, hold: readonly Status[]): Promise<void> => {
    try {
      if (mode === "conversation") {
        const design = await readJob(id, (job) => job.designSession);
        if (!design) throw new Error("This run has no design conversation");
        await runInteractiveDesign({ id, token: slot.token, signal: slot.abort.signal, onActivity: (line) => activity(id, slot, design.id, line), query: options.designQuery });
        return;
      }
      const runner = options.runner();
      for (;;) {
        if (slot.pauseRequested) {
          log(slot, "info", "paused");
          lifecycle(id, slot, "paused");
          return;
        }
        const result = await mutateJob(id, (job) => step(job, { hold, signal: slot.abort.signal }));
        slot.state.lastStep = result;
        if (result.action === "dispatch") for (const entry of result.dispatches) track(slot, entry.id);
        lifecycle(id, slot, "step");
        if (result.action === "dispatch") {
          const job = await readJob(id, (job) => job);
          const outcomes = await Promise.allSettled(result.dispatches.map((entry) => runOne(id, slot, runner, entry, job)));
          const failed = outcomes.find((o) => o.status === "rejected");
          if (failed !== undefined) throw failed.reason;
          if (mode === "step") return;
          continue;
        }
        if (result.action === "stop") {
          for (const o of result.overdue) {
            await mutateJob(id, (job) => finish(job, o.id, "timeout", null, "overdue; recorded by the console driver"));
            log(slot, "warn", `${o.id} ${o.agent} overdue since ${o.deadlineAt}; recorded as timeout`, o.id);
          }
          continue;
        }
        if (result.action === "wait") {
          const job = await readJob(id, (job) => job);
          const unlaunchedDispatches = job.dispatches.filter((d) => result.pending.includes(d.id) && d.execution?.launch === "pending");
          if (unlaunchedDispatches.length === result.pending.length) {
            for (const dispatch of unlaunchedDispatches) if (dispatch.execution) track(slot, dispatch.id);
            for (const dispatch of unlaunchedDispatches) if (dispatch.execution) await runOne(id, slot, runner, dispatch.execution.envelope, job);
            if (mode === "step") return;
            continue;
          }
          await mutateJob(id, (current) => {
            for (const dispatch of current.dispatches.filter((d) => result.pending.includes(d.id))) {
              if (dispatch.execution?.owner === slot.token) throw new SociotechnicError("driver-active", "This driver still owns an unfinished launch");
              finish(current,dispatch.id,"failed",null,"interrupted driver; uncommitted output was not accepted");
              if (dispatch.execution) dispatch.execution.launch="finished";
            }
          });
          log(slot, "warn", `recorded interrupted dispatches as failed; existing retry bounds apply: ${result.pending.join(", ")}`);
          continue;
        }
        if (result.action === "human") {
          const design = await readJob(id, (job) => job.designSession);
          if (design?.state === "ready") await runInteractiveDesign({ id, token: slot.token, signal: slot.abort.signal, onActivity: (line) => activity(id, slot, design.id, line), query: options.designQuery });
        }
        const why = result.action === "done" ? "done" : `${result.action}: ${result.reason}`;
        log(slot, "info", `stopped at ${result.status} (${why})`);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      slot.state.error = message;
      log(slot, "error", message);
      lifecycle(id, slot, "error");
    } finally {
      for (const control of slot.controls.values()) control.fail(new SociotechnicError("driver-stopped", "The driver stopped before recording this dispatch"));
      slot.controls.clear();
      try { await readJob(id, stopSandbox); }
      catch (error) { log(slot, "warn", error instanceof Error ? error.message : "Sandbox stop was not confirmed"); }
      slot.state.running = false;
      slot.state.finishedAt = nowIso();
      slot.state.active = [];
      slot.state.queued = [];
      await releaseDriver(id, process.pid);
      lifecycle(id, slot, "stopped");
    }
  };

  return {
    state: (id) => snapshot(slotOf(assertJobId(id))),
    isRunning: (id) => slots.get(id)?.state.running === true,
    async run(id, mode, hold) {
      assertJobId(id);
      const slot = slotOf(id);
      if (slot.state.running) throw new SociotechnicError("driver-active", `a driver is already running job ${id}`);
      const startedAt = nowIso();
      const job = await readJob(id, (job) => job);
      const next=statusLine(job).nextAction;
      if(next === "human" || next === "done")throw new SociotechnicError("illegal-transition", "A driver cannot advance a human gate or finished job");
      slot.token = await acquireDriver(id, { pid: process.pid, startedAt, mode, owner, ...(options.consoleUrl ? { consoleUrl: options.consoleUrl() } : {}) }, () => { slot.abort.abort(); slot.pauseRequested = true; });
      try { await effectJob(id,"restore",(current)=>{
        const action=statusLine(current).nextAction;
        if(action === "human" || action === "done")throw new SociotechnicError("illegal-transition","A driver cannot advance a human gate or finished job");
        if(restoreWorktree(current) === "no-branch")throw new SociotechnicError("no-branch","The job repository or branch is missing");
        if(current.creation)current.creation.state="complete";
      }); }
      catch(error) { await releaseDriver(id,process.pid); throw error; }
      slot.state = { ...emptyState(), running: true, mode, hold: [...hold], startedAt };
      slot.pauseRequested = false;
      slot.abort = new AbortController();
      log(slot, "info", `driver started (${mode}${hold.length > 0 ? `, hold ${hold.join(",")}` : ""})`);
      lifecycle(id, slot, "started");
      slot.loop = loop(id, slot, mode, hold);
      return snapshot(slot);
    },
    pause(id) {
      const slot = slotOf(assertJobId(id));
      if (slot.state.running && !slot.pauseRequested) {
        slot.pauseRequested = true;
        log(slot, "info", "pause requested; stopping after in-flight dispatches");
      }
      return snapshot(slot);
    },
    stop(id) {
      const slot = slotOf(assertJobId(id));
      if (slot.state.running) {
        slot.pauseRequested = true;
        slot.abort.abort();
        log(slot, "warn", "stop requested; aborting in-flight dispatches");
      }
      return snapshot(slot);
    },
    interrupt(id, dispatchId, note) {
      const slot = slots.get(assertJobId(id));
      if (slot === undefined || !slot.state.running) return null;
      const control = slot.controls.get(dispatchId);
      if (control === undefined) throw new SociotechnicError("dispatch-starting", `Dispatch ${dispatchId} is not running or queued in this console's driver; it may be starting or already recorded. Refresh and retry.`);
      if (control.interrupt === null) {
        if (control.recording) throw new IllegalTransition(`dispatch ${dispatchId} is already being recorded`);
        control.interrupt = { note };
        control.terminated = control.started;
        log(slot, "warn", `${dispatchId} interrupt requested by human${note === null ? "" : `: ${note}`}`, dispatchId);
        control.abort.abort();
      }
      const accepted = control.interrupt;
      return control.done.then(() => ({ job: id, dispatch: dispatchId, outcome: "interrupted" as const, note: accepted.note, terminated: control.terminated }));
    },
    logPage(id, after, limit) {
      const slot = slots.get(assertJobId(id));
      const entries = slot === undefined ? [] : slot.log.slice(slot.logStart);
      const first = entries[0]?.seq ?? null, last = entries.at(-1)?.seq ?? null;
      const start = first === null ? 0 : Math.min(entries.length, Math.max(0, after - first + 1));
      const page = entries.slice(start, start + limit);
      return { job: id, entries: page.map(({ seq, at, level, text, dispatchId }) => ({ seq, at, level, dispatchId, line: text })), first, last, more: start + page.length < entries.length };
    },
    capacity: () => ({ running: pool.running, queued: pool.queue.length }),
    capacityChanged: wake,
    settled: (id) => slots.get(id)?.loop ?? Promise.resolve(),
    async shutdown() {
      for (const slot of slots.values()) {
        slot.pauseRequested = true;
        slot.abort.abort();
      }
      await Promise.all([...slots.values()].map((s) => s.loop));
    },
  };
}
