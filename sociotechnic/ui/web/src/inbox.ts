import type { Status } from "../../../src/job.ts";
import type { JobItem } from "./model.ts";

export type InboxGroup = "needs" | "working" | "done";
export const INBOX_GROUPS: readonly InboxGroup[] = ["needs", "working", "done"];
export const inboxLabels: Record<InboxGroup, string> = { needs: "Needs you", working: "Working", done: "Done" };

const NEEDS: readonly Status[] = ["planning-input", "needs-human", "planned", "ready", "merged-local", "accepted", "design-input"];
const DONE: readonly Status[] = ["merged", "stopped"];

export function inboxGroup(job: Pick<JobItem, "status" | "running" | "archived">): InboxGroup {
  if (job.archived || DONE.includes(job.status)) return "done";
  if (NEEDS.includes(job.status)) return "needs";
  return job.running ? "working" : "needs";
}

export function groupCounts(jobs: readonly Pick<JobItem, "status" | "running" | "archived">[]): Record<InboxGroup, number> {
  const counts: Record<InboxGroup, number> = { needs: 0, working: 0, done: 0 };
  for (const job of jobs) counts[inboxGroup(job)] += 1;
  return counts;
}

export function defaultGroup(counts: Record<InboxGroup, number>): InboxGroup {
  return INBOX_GROUPS.find((group) => counts[group] > 0) ?? "needs";
}

export function isInboxGroup(value: unknown): value is InboxGroup {
  return value === "needs" || value === "working" || value === "done";
}

export function sinceUpdate(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "time unknown";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
