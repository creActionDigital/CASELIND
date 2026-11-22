#!/usr/bin/env node
/**
 * Planches de captures pour la chasse aux détails : chaque route en 375 px (clair, et sombre avec --dark), 8 vignettes par
 * planche, numérotées dans la sortie console.
 * Usage : PLAYWRIGHT=<paquet playwright> CHROME_PATH=<chrome-headless-shell.exe> node scripts/qa/sheets.mjs <nom> <compte> <route> [<route>...] [--dark]
 * Sortie : qa-out/sheets/<nom>-<thème>-<n>.png (vignettes 250x541) + captures pleine taille qa-out/sheets/<nom>/.
 * Les routes à paramètre doivent être données résolues (ex. /seller/<orgId>).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const Jimp = require('jimp-compact');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [name, who, ...routes] = args;
const themes = process.argv.includes('--dark') ? ['light', 'dark'] : ['light'];
const API = process.env.API_URL ?? 'http://localhost:3000/v1';
const WEB = process.env.WEB_URL ?? 'http://localhost:8081';
const dir = `qa-out/sheets/${name}`;
fs.mkdirSync(dir, { recursive: true });
const login = () => fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: `${who}@caselind.test`, password: 'TestPass-2026!' }) }).then((r) => r.json());

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const theme of themes) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: theme });
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
  const files = [];
  for (const [i, route] of routes.entries()) {
    if (who !== 'anon') await page.evaluate((t) => sessionStorage.setItem('caselind.refreshToken', t), (await login()).refreshToken);
    await page.goto(WEB + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const f = `${dir}/${theme}-${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  await page.close();
  for (let s = 0; s * 8 < files.length; s++) {
    const part = files.slice(s * 8, s * 8 + 8);
    const sheet = new Jimp(250 * 4, 541 * Math.ceil(part.length / 4), 0x888888ff);
    for (const [k, f] of part.entries()) sheet.composite((await Jimp.read(f)).resize(250, 541), (k % 4) * 250, Math.floor(k / 4) * 541);
    await sheet.writeAsync(`qa-out/sheets/${name}-${theme}-${s + 1}.png`);
  }
}
await browser.close();
routes.forEach((r, i) => console.log(`${i + 1}\t${r}`));
