import { errorMessage, evidence, object, parseBuildVerification, parseChecks, parseDetail, parseJobs, text } from "./model";
import type { Detail } from "./model";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code; }
}

export async function request(path: string, signal?: AbortSignal, body?: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { signal, method: body ? "POST" : "GET", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Cannot reach Sociotechnic. Check that the local console is running, then retry.");
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const body = typeof data === "object" && data !== null && !Array.isArray(data) ? object(data) : {};
    const message = text(body.error) || `Request failed (${response.status}).`;
    throw new ApiError(response.status === 409 ? `${message} Refresh this job before retrying.` : message, response.status, text(body.code));
  }
  return data;
}
export const jobUrl = (id: string) => `/api/jobs/${encodeURIComponent(id)}`;
export const recordUrl = (id: string, path: string, download = false) => `${jobUrl(id)}/records/${path.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`;
export const getJobs = async (signal?: AbortSignal) => parseJobs(await request("/api/jobs", signal));
export async function getRecord(id: string, path: string, signal?: AbortSignal): Promise<string> {
  const result = object(await request(recordUrl(id, path), signal));
  if (typeof result.text !== "string") throw new Error("The record response contains no text.");
  return result.text;
}
export async function getDetail(id: string, signal?: AbortSignal): Promise<Detail> {
  const detail = parseDetail(await request(jobUrl(id), signal));
  const { round } = evidence(detail);
  await Promise.all([loadChecks(), loadVerification()]);
  return detail;

  async function loadChecks() {
    if (!round?.checks) return;
    if (!detail.records.some((r) => r.path === round.checks?.path)) detail.checksError = "The referenced checks record is missing.";
    else {
      try { detail.checks = parseChecks(JSON.parse(await getRecord(id, round.checks.path, signal))); }
      catch (error) { if (signal?.aborted) throw error; detail.checksError = errorMessage(error); }
    }
  }
  async function loadVerification() {
    if (!round?.build) return;
    const path = `round-${detail.job.round}/build.md`;
    if (!detail.records.some((r) => r.path === path)) detail.verificationError = "The referenced build record is missing.";
    else {
      try { detail.verification = parseBuildVerification(await getRecord(id, path, signal)); }
      catch (error) { if (signal?.aborted) throw error; detail.verificationError = errorMessage(error); }
    }
  }
}
