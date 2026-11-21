#!/usr/bin/env node
/**
 * Robot QA : ouvre chaque écran de apps/mobile/src/app dans Expo web (http://localhost:8081) avec un compte de démo
 * et relève : erreurs JS, réponses API >= 500, écran d'erreur (« Oups »), clés i18n brutes, débordement horizontal.
 * Prérequis : API (3000) + Expo web (8081) démarrés, seed (scripts/seed-demo.mjs) passé, limites de débit relevées dans apps/api/.env.
 * Usage : [CHROME_PATH=<chrome.exe>] PLAYWRIGHT=<chemin du paquet playwright> node scripts/qa/crawl-screens.mjs [--pass=fr-light-375,sw-dark-375,en-light-1280] [--only=wallet]
 * Sortie : qa-out/crawl-<passe>.json et des captures qa-out/<passe>/*.png (dossier ignoré par git).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const API = process.env.API_URL ?? 'http://localhost:3000/v1';
const WEB = process.env.WEB_URL ?? 'http://localhost:8081';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres:caselind-dev-only@localhost:54329/caselind_utf8';
const PWD = 'TestPass-2026!';
const OUT = path.resolve('qa-out');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const passes = (arg('pass') ?? 'fr-light-375').split(',');
const only = arg('only');
const state = JSON.parse(fs.readFileSync('scripts/.seed-demo-state.json', 'utf8'));

async function sql(q, p = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}

async function http(method, p, token, body) {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(j)?.slice(0, 200)}`);
  return j;
}
const login = (who) => http('POST', '/auth/login', null, { identifier: `${who}@caselind.test`, password: PWD });

// Routes : chemin de fichier -> URL expo-router ; les paramètres connus viennent du seed, les autres sont résolus par l'API.
function routes() {
  const base = 'apps/mobile/src/app';
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.tsx') && f.name !== '_layout.tsx') out.push(path.relative(base, p).replace(/\\/g, '/').replace(/\.tsx$/, ''));
    }
  })(base);
  return out.sort();
}

async function params(alice) {
  const me = await http('GET', '/me', alice.accessToken);
  const bob = await http('GET', '/me', (await login('bob')).accessToken);
  const first = async (p, pick = (j) => (j.items ?? j)[0]?.id) => { try { return pick(await http('GET', p, alice.accessToken)); } catch { return undefined; } };
  const orgId = state.shop?.orgId;
  return {
    orgId, userId: bob.id, handle: bob.handle, postId: state.posts?.[0], conversationId: state.convs?.direct,
    slug: await first(`/orgs/${orgId}`, (j) => j.slug), tag: 'caselind', scope: 'service',
    classId: state.school?.classId, jobId: state.jobs?.jobId, deliveryId: undefined,
    productId: await first(`/orgs/${orgId}/products`), orderId: await first('/me/orders'),
    rideId: await first('/me/rides'), appId: await first('/miniapps'),
    me: me.id,
  };
}

// id de la ressource selon le dossier pour les routes .../[id]
function idFor(route, P) {
  const m = {
    'listings/[id]': state.listings?.apt, 'freelance/[id]': state.freelance?.mission, 'freelance/contract/[id]': state.freelance?.contract,
    'education/[id]': state.course?.course, 'education/edit/[id]': state.course?.course, 'education/quiz/[id]': undefined, 'education/exam/[id]': undefined,
    'services/[id]': state.service?.service, 'bookings/[id]': state.service?.booking, 'jobs/[id]': state.jobs?.jobId,
    'seller/[orgId]/jobs/[jobId]': state.jobs?.jobId,
  };
  for (const [k, v] of Object.entries(m)) if (route.endsWith(k)) return v;
  return undefined;
}

function toUrl(route, P) {
  let missing = false;
  const special = idFor(route, P);
  const url = '/' + route.split('/').filter((s) => !/^\(.*\)$/.test(s) && s !== 'index').map((s) => {
    const m = /^\[(.+)\]$/.exec(s);
    if (!m) return s;
    const v = m[1] === 'id' || m[1] === 'jobId' ? special ?? P[m[1]] : P[m[1]];
    if (!v) missing = true;
    return v ?? s;
  }).join('/');
  // orgId de l'école pour les écrans école vendeur
  return { url: route.includes('/school/') && route.startsWith('(app)/seller') ? url.replace(P.orgId, state.school?.orgId) : url, missing };
}

async function run(pass) {
  const [locale, theme, width] = pass.split('-');
  const dir = path.join(OUT, pass);
  fs.mkdirSync(dir, { recursive: true });
  const alice = await login('alice');
  await http('PATCH', '/me', alice.accessToken, { locale });
  const P = await params(alice);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: width === '375' ? 812 : 900 }, colorScheme: theme, isMobile: width === '375', hasTouch: width === '375' });
  const page = await ctx.newPage();
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
  let cur = { console: [], api: [] };
  page.on('console', (m) => { if (m.type() === 'error') cur.console.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => cur.console.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 500) cur.api.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`); });
  const results = [];
  for (const route of routes().filter((r) => !only || r.includes(only))) {
    if (route.startsWith('(auth)')) continue; // écrans hors connexion : parcourus à part
    const { url, missing } = toUrl(route, P);
    if (missing) { results.push({ route, url, status: 'param-non-résolu' }); continue; }
    // Une session neuve par écran : le jeton de rafraîchissement tourne à chaque rechargement complet.
    const { refreshToken } = await login('alice');
    await page.evaluate((t) => sessionStorage.setItem('caselind.refreshToken', t), refreshToken);
    cur = { console: [], api: [] };
    try {
      await page.goto(WEB + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => ({ text: document.body.innerText, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, path: location.pathname }));
      const keys = [...new Set((info.text.match(/\b[a-z][a-zA-Z0-9]+(?:\.[a-zA-Z0-9_]+){1,4}\b/g) ?? []).filter((k) => !/^(caselind\.test|www\.)|\.(png|jpg|jpeg|com|cd|test|org|net|pdf)$|^\d/.test(k)))];
      const problems = [];
      if (info.path.includes('sign-in') || info.path === '/auth') problems.push('renvoyé à la connexion');
      if (/Oups|Something went wrong|Une erreur est survenue/i.test(info.text)) problems.push('écran d\'erreur');
      if (keys.length) problems.push('clés brutes: ' + keys.slice(0, 5).join(', '));
      if (info.sw > info.cw + 1) problems.push(`débordement ${info.sw}>${info.cw}`);
      if (cur.api.length) problems.push('API: ' + cur.api.slice(0, 3).join(' | '));
      if (cur.console.length) problems.push('console: ' + cur.console.slice(0, 2).join(' | '));
      const shot = route.replace(/[()[\]/]/g, '_') + '.png';
      await page.screenshot({ path: path.join(dir, shot) });
      results.push({ route, url, status: problems.length ? 'KO' : 'OK', problems, words: info.text.split(/\s+/).length, shot });
    } catch (e) {
      results.push({ route, url, status: 'KO', problems: ['chargement: ' + e.message.slice(0, 150)] });
    }
    process.stdout.write(`${results.at(-1).status === 'OK' ? '.' : 'x'}`);
  }
  await browser.close();
  await http('PATCH', '/me', (await login('alice')).accessToken, { locale: 'fr' });
  fs.writeFileSync(path.join(OUT, `crawl-${pass}.json`), JSON.stringify(results, null, 1));
  const ko = results.filter((r) => r.status !== 'OK');
  console.log(`\n${pass}: ${results.length} écrans, ${results.length - ko.length} OK, ${ko.length} à voir`);
}

// Deux administrateurs pour la double validation : alice et hugo (base de dev uniquement).
await sql(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email IN ('alice@caselind.test','hugo@caselind.test')`);
for (const p of passes) await run(p);
