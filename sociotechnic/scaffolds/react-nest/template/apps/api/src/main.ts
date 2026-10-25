import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, resolvePort } from './app.setup.js';

async function bootstrap() {
  const port = resolvePort();
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  await app.listen(port);
}
await bootstrap();
