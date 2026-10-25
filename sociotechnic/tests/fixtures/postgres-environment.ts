export function explicitPostgresUrl(raw: string): URL {
  const parsed = new URL(raw);
  const host = parsed.searchParams.get("host") ?? decodeURIComponent(parsed.hostname);
  const port = parsed.searchParams.get("port") ?? parsed.port;
  if (parsed.searchParams.getAll("host").length > 1 || parsed.searchParams.getAll("port").length > 1) {
    throw new Error("PostgreSQL test endpoint forbids duplicate host or port parameters");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !host.trim() || !/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PostgreSQL test endpoint requires an explicit nonempty host and valid explicit port; default endpoints are forbidden");
  }
  return parsed;
}

export function configuredTestDatabaseUrl(raw: string | undefined): string | null {
  return raw === undefined ? null : explicitPostgresUrl(raw).toString();
}

export function postgresEnvironment(url: string): NodeJS.ProcessEnv {
  const parsed = explicitPostgresUrl(url);
  return {
    ...process.env,
    PGSERVICE: undefined,
    PGSERVICEFILE: undefined,
    PGHOSTADDR: undefined,
    PGHOST: parsed.searchParams.get("host") ?? decodeURIComponent(parsed.hostname),
    PGPORT: parsed.searchParams.get("port") ?? parsed.port,
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    ...(parsed.username ? { PGUSER: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}),
  };
}
