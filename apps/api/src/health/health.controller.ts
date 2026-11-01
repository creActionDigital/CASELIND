import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import pg from 'pg';
import { AppError } from '../common/app-error.js';
import { PG_POOL } from '../db/db.module.js';
import { Public } from '../security/auth.guard.js';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Liveness + database reachability. Reveals no version or configuration details. */
  @Get()
  async check(): Promise<{ status: 'ok'; db: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new AppError(503, 'internal_error', 'Database unavailable');
    }
    return { status: 'ok', db: 'ok' };
  }
}
