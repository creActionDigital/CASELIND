import { readdirSync } from 'node:fs';
import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import pg from 'pg';
import { AppError } from '../common/app-error.js';
import { PG_POOL } from '../db/db.module.js';
import { MIGRATIONS_DIR } from '../db/migrator.js';
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

  /** Liveness: the process answers. No database: a database outage must not make the orchestrator restart the API. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the database answers and the newest migration shipped with this build is applied. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; db: 'ok'; migrations: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new AppError(503, 'internal_error', 'Database unavailable');
    }
    const last = this.lastMigration;
    if (last) {
      const applied = await this.pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [last]).catch(() => null);
      if (!applied?.rowCount) throw new AppError(503, 'internal_error', 'Migrations pending');
    }
    return { status: 'ok', db: 'ok', migrations: 'ok' };
  }

  private readonly lastMigration: string | undefined = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .at(-1);
}
