// One command for local dev: database, compiled API, Expo web. Ctrl+C stops everything.
// The API runs compiled (not --watch): Expo touching node_modules restarts --watch in a loop.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const run = (cmd, cwd = root, opts = {}) => spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'pipe', 'inherit'], ...opts });
const kids = [];
const stopAll = () => {
  for (const k of kids) spawnSync(`taskkill /pid ${k.pid} /t /f`, { shell: true, stdio: 'ignore' });
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const start = (name, cmd, cwd, onLine) => {
  const p = run(cmd, cwd);
  kids.push(p);
  p.stdout.on('data', (d) => {
    process.stdout.write(`[${name}] ${d}`);
    onLine?.(String(d));
  });
  p.on('exit', (c) => console.log(`[${name}] arrêté (code ${c})`));
};

let apiStarted = false;
start('db', 'npm run db:dev -w @caselind/api', root, (l) => {
  if (apiStarted || !l.includes('Dev PostgreSQL ready')) return;
  apiStarted = true;
  const build = spawnSync('npm run build -w @caselind/api', { cwd: root, shell: true, stdio: 'inherit' });
  if (build.status !== 0) return stopAll();
  start('api', 'node --env-file=.env dist/main.js', join(root, 'apps', 'api'));
  start('app', 'npx expo start --web --port 8083', join(root, 'apps', 'mobile'));
});
