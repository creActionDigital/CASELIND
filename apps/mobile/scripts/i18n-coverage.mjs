// Couverture i18n : liste les clés de en.ts absentes d'une langue (sw par défaut).
// Usage : node scripts/i18n-coverage.mjs [sw] [--json out.json] [--list]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require(path.join(root, 'node_modules/typescript'));
const Module = require('node:module');
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, file) =>
    mod._compile(
      ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
      file,
    );
}
const args = process.argv.slice(2);
const lang = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--json') + 1]) ?? 'sw';
const dict = require(path.join(root, 'src/i18n', `${lang}.ts`))[lang];
const en = require(path.join(root, 'src/i18n/en.ts')).en;
const missing = Object.keys(en).filter((k) => !(k in dict));
const extra = Object.keys(dict).filter((k) => !(k in en));
console.log(`${lang}: ${Object.keys(en).length - missing.length}/${Object.keys(en).length} clés traduites, ${missing.length} manquantes, ${extra.length} hors en.ts`);
const byPrefix = {};
for (const k of missing) byPrefix[k.split('.')[0]] = (byPrefix[k.split('.')[0]] ?? 0) + 1;
console.log(Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join(' '));
if (args.includes('--list')) for (const k of missing) console.log(`${k}\t${en[k]}`);
const j = args.indexOf('--json');
if (j >= 0) writeFileSync(args[j + 1], JSON.stringify(Object.fromEntries(missing.map((k) => [k, en[k]])), null, 1));
process.exitCode = 0;
