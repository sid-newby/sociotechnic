import type { Dispatch } from "./model.ts";
import { dispatchElapsed } from "./run-model.ts";
import type { DispatchDriver } from "./run-model.ts";
export const dispatchColumnLabels: Record<string, string> = { id: "Dispatch", agent: "Role", status: "Status", round: "Round", started: "Started", tokens: "Tokens", elapsed: "Elapsed", model: "Model / effort", record: "Record" };
const csvCell = (value: string) => `"${(/^[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
export function dispatchCsv(rows: readonly Dispatch[], columns: readonly string[], now: number, status: (dispatch: Dispatch) => string, driver: DispatchDriver): string {
  const value = (dispatch: Dispatch, key: string): string => {
    switch (key) {
      case "id": return dispatch.id;
      case "agent": return dispatch.agent;
      case "status": return status(dispatch);
      case "round": return String(dispatch.round);
      case "started": return dispatch.startedAt || "Not recorded";
      case "tokens": return dispatch.usage.tokens === null ? "Not reported" : String(dispatch.usage.tokens);
      case "elapsed": { const ms = dispatchElapsed(dispatch, now, driver); return ms === null ? "Not recorded" : String(ms / 1000); }
      case "model": return `${dispatch.model} / ${dispatch.effort}`;
      case "record": return dispatch.record;
      default: return "";
    }
  };
  const selected = columns.filter((column) => Object.hasOwn(dispatchColumnLabels, column));
  return [selected.map((key) => csvCell(dispatchColumnLabels[key])), ...rows.map((row) => selected.map((key) => csvCell(value(row, key))))].map((row) => row.join(",")).join("\r\n") + "\r\n";
}
