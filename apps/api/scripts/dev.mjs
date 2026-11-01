// Dev loop: TypeScript watch build + Node restart on change. Reads apps/api/.env.
// Start the database first with `npm run db:dev`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  console.error('Missing apps/api/.env — copy .env.example to .env and fill in the secrets.');
  process.exit(1);
}

const run = (cmd, args) => spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
run('npm', ['run', 'build', '-w', '@caselind/contracts']).on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  run('npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);
  setTimeout(() => run('node', ['--env-file=.env', '--watch', 'dist/main.js']), 4000);
});
