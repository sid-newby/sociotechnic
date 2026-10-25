import type { INestApplication } from '@nestjs/common';

export const DEFAULT_PORT = 3000;

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  return app;
}

export function resolvePort(raw: string | undefined = process.env.PORT): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer from 1 to 65535`);
  }
  return port;
}
