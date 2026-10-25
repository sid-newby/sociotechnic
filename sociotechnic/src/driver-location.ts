export type DriverOwnership =
  | { kind: "none" | "local" | "interrupted" }
  | { kind: "external"; owner: "ui" | "cli" | "unknown"; url: string | null };

export function owningConsoleUrl(value: unknown, id: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.port === "0" || url.username || url.password || url.pathname !== "/" || url.search) return null;
    url.hash = new URLSearchParams({ job: id }).toString();
    return url.href;
  } catch { return null; }
}
