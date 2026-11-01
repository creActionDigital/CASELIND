import { migrate } from './migrator.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const result = await migrate(url);
console.log(`migrations applied: ${result.applied.join(', ') || 'none'}; already applied: ${result.skipped.length}`);
