import { runInteractiveDesign } from "./design-session-runner.ts";
import type { DesignQuery } from "./design-session-runner.ts";
import { versionRole } from "../src/agent-versions.ts";

import type { DispatchOut, StepResult } from "../src/engine.ts";
import { mutateJob, readJob, effectJob } from "../src/job-store.ts";
export { mutateJob } from "../src/job-store.ts";
import { prepareDispatch, ingestDispatch, stagedRecord } from "../src/staging.ts";
import { finish, step, statusLine } from "../src/engine.ts";
import { acquireDriver, releaseDriver } from "../src/driverlock.ts";
import type { DriverOwner } from "../src/driverlock.ts";
import { SociotechnicError } from "../src/errors.ts";
import type { Job, Status } from "../src/job.ts";


import { restoreWorktree } from "../src/db/restore.ts";
import { assertJobId, sociotechnicHome } from "../src/paths.ts";
import { roleOf } from "../src/roles.ts";
import { removeSandboxDispatch, stopSandbox } from "../src/sandbox.ts";
import { nowIso } from "../src/time.ts";
import type { Runner } from "./runner.ts";

export type DriverMode = "run" | "step" | "conversation";
export type LogEntry = { at: string; level: "info" | "warn" | "error"; text: string };
export type ActiveDispatch = { dispatchId: string; agent: string; startedAt: string; deadlineAt: string; lastActivity: string | null };

export type DriverState = {
  running: boolean;
  mode: DriverMode | null;
  hold: string[];
  startedAt: string | null;
  finishedAt: string | null;
  active: ActiveDispatch[];
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
  settled: (id: string) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type DriverOptions = { runner: () => Runner; emit: (event: DriverEvent) => void; owner?: DriverOwner; consoleUrl?: () => string; designQuery?: DesignQuery };

const LOG_CAP = 200;
const ACTIVITY_INTERVAL_MS = 250;

function emptyState(): DriverState {
  return { running: false, mode: null, hold: [], startedAt: null, finishedAt: null, active: [], log: [], lastStep: null, error: null };
}

type Slot = {
  state: DriverState;
  pauseRequested: boolean;
  token: string;
  abort: AbortController;
  loop: Promise<void>;
  activity: Map<string, { last: number; timer: NodeJS.Timeout | null; pending: LogEntry[] }>;
};

function roundOf(record: string): number {
  const m = /^round-(\d+)\//.exec(record);
  return m === null ? 0 : Number(m[1]);
}

function snapshot(state: DriverState): DriverState {
  return { ...state, hold: [...state.hold], active: state.active.map((a) => ({ ...a })), log: [...state.log] };
}

export function createDriverRegistry(options: DriverOptions): DriverRegistry {
  const slots = new Map<string, Slot>();
  const owner = options.owner ?? "ui";

  const slotOf = (id: string): Slot => {
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = { state: emptyState(), pauseRequested: false, token: "", abort: new AbortController(), loop: Promise.resolve(), activity: new Map() };
      slots.set(id, slot);
    }
    return slot;
  };

  const log = (slot: Slot, level: LogEntry["level"], text: string): LogEntry => {
    const entry: LogEntry = { at: nowIso(), level, text };
    slot.state.log.push(entry);
    if (slot.state.log.length > LOG_CAP) slot.state.log.splice(0, slot.state.log.length - LOG_CAP);
    return entry;
  };

  const lifecycle = (id: string, slot: Slot, event: LifecycleEvent): void => {
    options.emit({ id, event, state: snapshot(slot.state) });
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
    const entry = log(slot, "info", line);
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

  const runOne = async (id: string, slot: Slot, runner: Runner, entry: DispatchOut, job: Job): Promise<void> => {
    const baseRole = roleOf(entry.configuration?.baseRole ?? entry.agent);
    const role = entry.configuration ? versionRole({ ...baseRole, name: entry.agent }, entry.configuration) : baseRole;
    slot.state.active.push({ dispatchId: entry.id, agent: entry.agent, startedAt: nowIso(), deadlineAt: entry.deadlineAt, lastActivity: null });
    log(slot, "info", `${entry.id} ${entry.agent} ${entry.configuration?.version ? `v${entry.configuration.version}` : "version unrecorded"} started (${entry.model}, ${entry.effort}) -> ${entry.record}`);
    lifecycle(id, slot, "dispatch-started");
    const stage = await prepareDispatch(id, entry, slot.token);
    let result: Awaited<ReturnType<Runner["run"]>>;
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
        signal: slot.abort.signal,
        onActivity: (line) => activity(id, slot, entry.id, line),
        onWarn: (line) => {
          log(slot, "warn", line);
        },
      });
    } catch (err) {
      result = { outcome: "failed", usage: null, note: err instanceof Error ? err.message : String(err) };
    }
    const a = slot.activity.get(entry.id);
    if (a !== undefined) {
      if (a.timer !== null) clearTimeout(a.timer);
      a.timer = null;
      flushActivity(id, entry.id, slot);
      slot.activity.delete(entry.id);
    }
    const finished = await ingestDispatch(id, stage, result);
    try { await removeSandboxDispatch(job, entry.id); }
    catch { log(slot, "warn", `Sandbox staging for ${entry.id} was retained; committed records are safe in PostgreSQL.`); }
    slot.state.active = slot.state.active.filter((x) => x.dispatchId !== entry.id);
    const level = result.outcome === "ok" ? "info" : "warn";
    log(slot, level, `${entry.id} ${entry.agent} ${result.outcome}; record ${finished.parsed?.effective}${result.note === null ? "" : ` (${result.note})`}`);
    lifecycle(id, slot, "dispatch-finished");
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
            log(slot, "warn", `${o.id} ${o.agent} overdue since ${o.deadlineAt}; recorded as timeout`);
          }
          continue;
        }
        if (result.action === "wait") {
          const job = await readJob(id, (job) => job);
          const unlaunched = job.dispatches.filter((d) => result.pending.includes(d.id) && d.execution?.launch === "pending");
          if (unlaunched.length === result.pending.length) {
            for (const dispatch of unlaunched) if (dispatch.execution) await runOne(id, slot, runner, dispatch.execution.envelope, job);
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
      try { await readJob(id, stopSandbox); }
      catch (error) { log(slot, "warn", error instanceof Error ? error.message : "Sandbox stop was not confirmed"); }
      slot.state.running = false;
      slot.state.finishedAt = nowIso();
      slot.state.active = [];
      await releaseDriver(id, process.pid);
      lifecycle(id, slot, "stopped");
    }
  };

  return {
    state: (id) => snapshot(slotOf(assertJobId(id)).state),
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
      slot.state = { ...emptyState(), log: slot.state.log, running: true, mode, hold: [...hold], startedAt };
      slot.pauseRequested = false;
      slot.abort = new AbortController();
      log(slot, "info", `driver started (${mode}${hold.length > 0 ? `, hold ${hold.join(",")}` : ""})`);
      lifecycle(id, slot, "started");
      slot.loop = loop(id, slot, mode, hold);
      return snapshot(slot.state);
    },
    pause(id) {
      const slot = slotOf(assertJobId(id));
      if (slot.state.running && !slot.pauseRequested) {
        slot.pauseRequested = true;
        log(slot, "info", "pause requested; stopping after in-flight dispatches");
      }
      return snapshot(slot.state);
    },
    stop(id) {
      const slot = slotOf(assertJobId(id));
      if (slot.state.running) {
        slot.pauseRequested = true;
        slot.abort.abort();
        log(slot, "warn", "stop requested; aborting in-flight dispatches");
      }
      return snapshot(slot.state);
    },
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
