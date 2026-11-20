#!/usr/bin/env node
/**
 * Test de charge de l'API, sans outil externe (Node >= 22, fetch natif). Voir docs/LOAD_TESTING.md.
 *
 * Variables : BASE_URL (http://localhost:3000), USERS (10), DURATION_S (30), RAMP_S (5), THINK_MS (200),
 *   ACCOUNTS ("id:motdepasse,id:motdepasse" ; defaut : comptes de scripts/seed-demo.mjs), ACCOUNTS_FILE (JSON [{identifier,password}]),
 *   P95_MS (800) et ERROR_RATE (0.01) = seuils ; OUT_FILE = chemin du rapport JSON ; JSON=1 = JSON seul sur stdout.
 * Code de sortie : 0 seuils tenus, 1 seuil depasse, 2 preparation impossible (aucune connexion).
 */
import fs from 'node:fs';
import { summarize } from './stats.mjs';

const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const USERS = num('USERS', 10);
const DURATION_S = num('DURATION_S', 30);
const RAMP_S = num('RAMP_S', 5);
const THINK_MS = num('THINK_MS', 200);
const P95_MS = num('P95_MS', 800);
const ERROR_RATE = num('ERROR_RATE', 0.01);
const JSON_ONLY = process.env.JSON === '1';
const log = (...a) => {
  if (!JSON_ONLY) console.log(...a);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadAccounts() {
  if (process.env.ACCOUNTS_FILE) return JSON.parse(fs.readFileSync(process.env.ACCOUNTS_FILE, 'utf8'));
  const raw =
    process.env.ACCOUNTS ??
    ['alice', 'bob', 'carla', 'david', 'emma', 'frank', 'gina', 'hugo'].map((n) => `${n}@caselind.test:TestPass-2026!`).join(',');
  return raw.split(',').map((p) => {
    const i = p.indexOf(':');
    return { identifier: p.slice(0, i), password: p.slice(i + 1) };
  });
}

async function login(s) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${BASE_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: s.account.identifier, password: s.account.password, device: { name: 'load-test', platform: 'other' } }),
    }).catch(() => null);
    if (!res) return false;
    if (res.ok) {
      s.token = (await res.json()).accessToken;
      return true;
    }
    if (res.status === 429) {
      await sleep(7000); // auth rate limit (AUTH_RATE_LIMIT_PER_MINUTE)
      continue;
    }
    return false;
  }
  return false;
}
// One login at a time per account when a token expires (access tokens last 15 minutes by default).
const relogin = (s) => (s.pending ??= login(s).finally(() => (s.pending = null)));

const shared = { productIds: [], variantIds: [] };

// Operations: weight, and how to issue the request. The client `c` is per virtual user.
const ops = [
  { name: 'catalog', weight: 35, run: (c) => c.get('/v1/products?limit=20') },
  {
    name: 'product',
    weight: 15,
    run: (c) => (shared.productIds.length ? c.get(`/v1/products/${shared.productIds[c.n() % shared.productIds.length]}`) : c.get('/v1/products?limit=5')),
  },
  { name: 'search', weight: 15, run: (c) => c.get(`/v1/search?q=${['shop', 'bob', 'alice', 'job', 'cours'][c.n() % 5]}&limit=10`) },
  { name: 'feed', weight: 15, run: (c) => c.get('/v1/feed') },
  { name: 'places', weight: 10, run: (c) => c.get('/v1/places?lat=-1.6585&lng=29.2205&radiusKm=20&limit=20') },
  {
    name: 'cart',
    weight: 10,
    run: (c) =>
      shared.variantIds.length ? c.put(`/v1/cart/items/${shared.variantIds[c.n() % shared.variantIds.length]}`, { quantity: 1 + (c.n() % 2) }) : c.get('/v1/cart'),
  },
];

function makeClient(s) {
  let k = Math.floor(Math.random() * 1000);
  const send = (method, path, body) =>
    fetch(BASE_URL + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const call = async (method, path, body) => {
    const t0 = performance.now();
    let status = 0;
    try {
      let res = await send(method, path, body);
      if (res.status === 401 && (await relogin(s))) res = await send(method, path, body);
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = 0; // network error or timeout: counted as a failure
    }
    return { status, ms: performance.now() - t0 };
  };
  return { get: (p) => call('GET', p), put: (p, b) => call('PUT', p, b), n: () => k++ };
}

const pick = (list) => {
  let r = Math.random() * list.reduce((a, o) => a + o.weight, 0);
  for (const o of list) if ((r -= o.weight) < 0) return o;
  return list[0];
};

async function main() {
  const sessions = loadAccounts().map((account) => ({ account, token: null, pending: null }));
  log(`Connexion de ${sessions.length} compte(s) sur ${BASE_URL} ...`);
  for (const s of sessions) await login(s);
  const live = sessions.filter((s) => s.token);
  if (live.length === 0) {
    console.error('Aucune connexion possible : verifier BASE_URL et ACCOUNTS (voir docs/LOAD_TESTING.md).');
    return 2;
  }
  if (live.length < sessions.length) log(`Avertissement : ${sessions.length - live.length} compte(s) non connecte(s), ignores.`);

  // Warm-up: discover ids, and drop operations whose module is off (403/404) instead of counting them as errors.
  const auth = { headers: { authorization: `Bearer ${live[0].token}` } };
  try {
    const r = await fetch(`${BASE_URL}/v1/products?limit=10`, auth);
    if (r.ok) {
      shared.productIds = ((await r.json()).items ?? []).map((p) => p.id);
      for (const id of shared.productIds.slice(0, 3)) {
        const d = await fetch(`${BASE_URL}/v1/products/${id}`, auth);
        if (d.ok) for (const v of (await d.json()).variants ?? []) if (v.id) shared.variantIds.push(v.id);
      }
    }
  } catch {
    /* reported by the probe below */
  }
  const probe = makeClient(live[0]);
  const active = [];
  for (const o of ops) {
    const { status } = await o.run(probe);
    if (status === 403 || status === 404) log(`Operation "${o.name}" ignoree (HTTP ${status} : module desactive ?)`);
    else active.push(o);
  }
  if (active.length === 0) {
    console.error('Aucune operation disponible.');
    return 2;
  }

  const per = new Map(active.map((o) => [o.name, { lat: [], failed: 0, rateLimited: 0, statuses: {} }]));
  const all = { lat: [], failed: 0, rateLimited: 0 };
  const t0 = performance.now();
  const endAt = t0 + DURATION_S * 1000;

  async function virtualUser(i) {
    await sleep(USERS > 1 ? (i * RAMP_S * 1000) / USERS : 0);
    const client = makeClient(live[i % live.length]);
    while (performance.now() < endAt) {
      const o = pick(active);
      const { status, ms } = await o.run(client);
      const rec = per.get(o.name);
      const bad = status < 200 || status >= 300;
      for (const t of [rec, all]) {
        t.lat.push(ms);
        if (bad) t.failed++;
        if (status === 429) t.rateLimited++;
      }
      rec.statuses[status] = (rec.statuses[status] ?? 0) + 1;
      await sleep(THINK_MS * (0.5 + Math.random()));
    }
  }
  await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(i)));
  const elapsedS = (performance.now() - t0) / 1000;

  const total = { ...summarize(all.lat, all.failed, elapsedS), rateLimited: all.rateLimited };
  const operations = Object.fromEntries(
    [...per].map(([name, r]) => [name, { ...summarize(r.lat, r.failed, elapsedS), rateLimited: r.rateLimited, statuses: r.statuses }]),
  );
  const passed = total.p95 <= P95_MS && total.errorRate <= ERROR_RATE;
  const report = { baseUrl: BASE_URL, users: USERS, durationS: DURATION_S, rampS: RAMP_S, elapsedS, thresholds: { P95_MS, ERROR_RATE }, total, operations, passed };
  if (process.env.OUT_FILE) fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(report, null, 2));

  if (JSON_ONLY) console.log(JSON.stringify(report));
  else {
    const f = (x) => (Number.isFinite(x) ? x.toFixed(0).padStart(6) : '     -');
    console.log(`\nCharge : ${USERS} utilisateurs, ${elapsedS.toFixed(1)} s, ${total.count} requetes, ${total.rps.toFixed(1)} req/s`);
    console.log('operation      requetes  echecs     p50    p95    p99    max');
    for (const [name, r] of Object.entries(operations)) console.log(`${name.padEnd(14)} ${String(r.count).padStart(8)} ${String(r.failed).padStart(7)} ${f(r.p50)} ${f(r.p95)} ${f(r.p99)} ${f(r.max)}`);
    console.log(`${'TOTAL'.padEnd(14)} ${String(total.count).padStart(8)} ${String(total.failed).padStart(7)} ${f(total.p50)} ${f(total.p95)} ${f(total.p99)} ${f(total.max)}  (ms)`);
    console.log(`Taux d'erreur ${(total.errorRate * 100).toFixed(2)} % (dont ${total.rateLimited} refus 429 du limiteur) ; seuils : p95 <= ${P95_MS} ms, erreurs <= ${(ERROR_RATE * 100).toFixed(2)} %`);
    console.log(passed ? 'RESULTAT : OK' : 'RESULTAT : ECHEC (seuil depasse)');
  }
  return passed ? 0 : 1;
}

process.exitCode = await main();
