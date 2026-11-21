#!/usr/bin/env node
/**
 * Tableau Markdown écran → résultat par passe, à partir de qa-out/crawl-<passe>.json (scripts/qa/crawl-screens.mjs).
 * Usage : node scripts/qa/crawl-report.mjs fr-light-375 sw-dark-375 en-light-1280 > qa-out/tableau.md
 * Une cellule vaut OK, « param. » (identifiant non résolu : écran couvert par un parcours) ou le premier problème relevé.
 */
import fs from 'node:fs';

const passes = process.argv.slice(2);
const data = Object.fromEntries(passes.map((p) => [p, JSON.parse(fs.readFileSync(`qa-out/crawl-${p}.json`, 'utf8'))]));
const routes = [...new Set(passes.flatMap((p) => data[p].map((r) => r.route)))].sort();
const cell = (r) => (!r ? '-' : r.status === 'OK' ? 'OK' : r.status === 'param-non-résolu' ? 'param.' : `KO : ${(r.problems ?? [])[0]?.replace(/\|/g, '/').slice(0, 90) ?? ''}`);
const head = `| Écran | ${passes.join(' | ')} |\n|---|${passes.map(() => '---').join('|')}|`;
const rows = routes.map((route) => `| ${route.replace(/^\(app\)\//, '').replace(/\|/g, '/')} | ${passes.map((p) => cell(data[p].find((r) => r.route === route))).join(' | ')} |`);
const totals = passes.map((p) => {
  const n = (s) => data[p].filter((r) => r.status === s).length;
  return `${p} : ${n('OK')} OK, ${n('KO')} KO, ${n('param-non-résolu')} non ouverts (paramètre)`;
});
console.log(`${totals.map((t) => `- ${t}`).join('\n')}\n\n${head}\n${rows.join('\n')}`);
