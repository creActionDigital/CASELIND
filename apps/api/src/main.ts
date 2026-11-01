import { createApp } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { migrate } from './db/migrator.js';

const env = loadEnv();
const result = await migrate(env.DATABASE_URL);
const app = await createApp({ env });
await app.listen(env.PORT);
console.log(
  `CASELIND API listening on http://localhost:${env.PORT}/v1 (migrations applied: ${result.applied.length})`,
);
