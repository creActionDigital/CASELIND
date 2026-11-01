import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** apps/api/migrations, resolved from both src/db and dist/db. */
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies pending *.sql migrations in lexical order, each in its own transaction.
 * A checksum guards against editing a migration after it was applied.
 */
export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Serialize concurrent migrators (e.g. several instances starting at once).
    await client.query('SELECT pg_advisory_lock(727372)');

    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727372)').catch(() => undefined);
    await client.end();
  }
}
