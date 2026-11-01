import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

/**
 * Starts one real PostgreSQL server for the whole run (no mocks of the database).
 * Each test file then creates and migrates its own database (see test/helpers.ts).
 * Set TEST_DATABASE_ADMIN_URL to use an existing server instead (e.g. in CI).
 */
export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_ADMIN_URL;
  if (external) {
    project.provide('pgAdminUrl', external);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'caselind-pg-'));
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password: 'postgres-test-only',
    // We delete the directory ourselves below: the library's own cleanup (persistent: false)
    // runs a plain rm right after taskkill and fails with EBUSY on Windows.
    persistent: true,
    onLog: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  project.provide('pgAdminUrl', `postgres://postgres:postgres-test-only@localhost:${port}/postgres`);

  return async () => {
    await pg.stop();
    // On Windows the stopped server can keep files open for a moment (EBUSY): retry, then
    // leave the temp dir behind rather than failing an otherwise green run.
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err;
      console.warn(`could not remove the test PostgreSQL directory ${dir} (EBUSY); delete it manually`);
    }
  };
}
