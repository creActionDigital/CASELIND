import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Headers, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type pg from 'pg';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { PG_POOL } from '../db/db.module.js';
import { Public } from '../security/auth.guard.js';
import { renderMetrics } from './metrics.js';

/** Prometheus scrape endpoint, mounted outside /v1 (see bootstrap). Disabled (404) without METRICS_TOKEN. */
@Controller('metrics')
@Public()
@SkipThrottle()
export class MetricsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(@Headers('authorization') authorization?: string): string {
    const expected = this.env.METRICS_TOKEN;
    if (!expected) throw AppError.notFound();
    const given = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    const want = Buffer.from(expected);
    // timingSafeEqual needs equal lengths; the token length is not a secret.
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw AppError.unauthenticated('Invalid metrics token');
    }
    return renderMetrics(this.pool);
  }
}
