// Local development database: a real PostgreSQL server run from npm binaries (no Docker needed).
// Data persists in apps/api/.data/pg (git-ignored). Stop with Ctrl+C.
// PostGIS is NOT included: production targets PostgreSQL + PostGIS (see docs/architecture).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = join(root, '.data', 'pg');
const port = Number(process.env.DEV_DB_PORT ?? 54329);
const password = process.env.DEV_DB_PASSWORD ?? 'caselind-dev-only';

const pg = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password, persistent: true });
if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('caselind');
} catch {
  // already exists
}
console.log(`Dev PostgreSQL ready: postgres://postgres:${password}@localhost:${port}/caselind`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
