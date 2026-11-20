import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { httpMetricsMiddleware } from './observability/metrics.js';
import { CaselindIoAdapter } from './realtime/realtime.adapter.js';

/** Builds the HTTP application. Shared by main.ts and the integration tests. */
export async function createApp(options: AppModuleOptions): Promise<INestApplication> {
  const { env } = options;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(httpMetricsMiddleware);
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: false,
  });
  app.useWebSocketAdapter(new CaselindIoAdapter(app, env.CORS_ORIGINS));
  // /metrics is a scrape target for the infrastructure, not part of the versioned API.
  app.setGlobalPrefix('v1', { exclude: ['metrics'] });
  app.enableShutdownHooks();
  return app;
}
