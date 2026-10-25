import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type Health = {
  status: string;
  service: string;
  uptime: number;
  timestamp: string;
};

type Failure = { title: string; hint: string };

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; failure: Failure };

const START_HINT = 'Start both apps with pnpm dev; the API listens on :3000.';

function isHealth(value: unknown): value is Health {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === 'string' &&
    typeof v.service === 'string' &&
    typeof v.uptime === 'number' &&
    typeof v.timestamp === 'string'
  );
}

async function fetchHealth(): Promise<Health | Failure> {
  let res: Response;
  try {
    res = await fetch('/api/health');
  } catch {
    return { title: 'Could not reach the dev server.', hint: START_HINT };
  }
  if (!res.ok) {
    return res.status >= 500
      ? { title: `The API is not responding (HTTP ${res.status}).`, hint: START_HINT }
      : { title: `The API returned HTTP ${res.status}.`, hint: 'Check the /api/health route.' };
  }
  const body: unknown = await res.json().catch(() => undefined);
  return isHealth(body)
    ? body
    : { title: 'The API sent an unexpected response.', hint: 'Expected the health JSON payload.' };
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inFlight = useRef(false);
  const loading = state.kind === 'loading';

  async function ping() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'loading' });
    const result = await fetchHealth();
    setState(
      isHealth(result) ? { kind: 'ok', health: result } : { kind: 'error', failure: result },
    );
    inFlight.current = false;
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>bay01</h1>
          </CardTitle>
          <CardDescription>
            Vite + React on :5173, NestJS on :3000 via the /api proxy.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm" aria-live="polite">
          {state.kind === 'idle' && <p className="text-muted-foreground">Not pinged yet.</p>}
          {state.kind === 'loading' && <p className="text-muted-foreground">Pinging…</p>}
          {state.kind === 'error' && (
            <div className="space-y-1">
              <p className="font-medium text-destructive">{state.failure.title}</p>
              <p className="text-muted-foreground">{state.failure.hint}</p>
            </div>
          )}
          {state.kind === 'ok' && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">status</dt>
              <dd className="font-medium text-emerald-700 dark:text-emerald-400">
                {state.health.status}
              </dd>
              <dt className="text-muted-foreground">uptime</dt>
              <dd>{state.health.uptime.toFixed(1)}s</dd>
              <dt className="text-muted-foreground">timestamp</dt>
              <dd className="truncate">{state.health.timestamp}</dd>
            </dl>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full aria-disabled:cursor-progress aria-disabled:opacity-50"
            onClick={ping}
            aria-disabled={loading}
          >
            Ping API
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
