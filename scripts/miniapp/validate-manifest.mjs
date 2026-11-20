#!/usr/bin/env node
// Validates a mini-app manifest.json against the shared schema (same rules as the API at submission).
// Usage: node scripts/miniapp/validate-manifest.mjs manifest.json [--scopes profile.basic,notify]
// Without --scopes the scopes are those described in dataAccessed. Needs `npm run build -w @caselind/contracts` once.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = args.indexOf('--scopes');
const file = args.find((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1));
if (!file) {
  console.error('usage: validate-manifest.mjs <manifest.json> [--scopes a,b]');
  process.exit(2);
}

let validateManifest;
try {
  ({ validateManifest } = await import(pathToFileURL(resolve(import.meta.dirname, '../../packages/contracts/dist/index.js')).href));
} catch {
  console.error('contracts are not built: run `npm run build -w @caselind/contracts`');
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}
const scopes = flag >= 0 ? (args[flag + 1] ?? '').split(',').filter(Boolean) : (raw?.dataAccessed ?? []).map((d) => d.scope);
const result = validateManifest(raw, scopes);
if (result.ok) {
  console.log(`OK: manifest valid for scopes [${scopes.join(', ')}]`);
} else {
  for (const p of result.problems) console.error(`- ${p.path}: ${p.message}`);
  console.error(`${result.problems.length} problem(s)`);
  process.exit(1);
}
