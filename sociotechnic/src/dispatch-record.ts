/** A reused output path belongs to the next attempt after its original bytes are retained. */
export function dispatchRecord(dispatches: readonly { id: string; record: string }[], dispatch: { id: string; record: string }): string {
  const index = dispatches.findIndex((entry) => entry.id === dispatch.id);
  if (index < 0) return dispatch.record;
  const next = dispatches.slice(index + 1).find((entry) => entry.record === dispatch.record);
  return next ? `${dispatch.record}.superseded-by-${next.id}` : dispatch.record;
}
