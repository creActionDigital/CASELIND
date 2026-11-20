#!/usr/bin/env node
/**
 * Test de fumee de deploiement (Node >= 22). Voir docs/DEPLOYMENT.md, section "Test de fumee".
 *
 * Usage :  BASE_URL=https://api.exemple.com SMOKE_IDENTIFIER=smoke@exemple.com SMOKE_PASSWORD=... node scripts/smoke/smoke.mjs
 * Variables : BASE_URL (http://localhost:3000, sans /v1), SMOKE_IDENTIFIER + SMOKE_PASSWORD (compte de test existant,
 *   sans quoi le parcours connecte est IGNORE ; SMOKE_REQUIRE_ACCOUNT=1 le rend obligatoire),
 *   SMOKE_ORG_SLUG (boutique publique a lister, facultatif), METRICS_TOKEN (verifie aussi GET /metrics), TIMEOUT_MS (10000).
 * Sortie : une ligne OK / ECHEC / IGNORE par etape ; code 0 si aucune etape en echec, 1 sinon.
 */
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 10_000);
const EXPECTED_PATHS = ['/v1/health', '/v1/health/live', '/v1/health/ready', '/v1/auth/login', '/v1/auth/register', '/v1/me', '/v1/products'];

const results = [];
async function step(name, fn) {
  const t0 = performance.now();
  try {
    const note = await fn();
    if (note === 'skip') results.push(['IGNORE', name, 'non configure']);
    else results.push(['OK', name, `${Math.round(performance.now() - t0)} ms${note ? `, ${note}` : ''}`]);
  } catch (err) {
    results.push(['ECHEC', name, err instanceof Error ? err.message : String(err)]);
  }
  const [state, label, detail] = results.at(-1);
  console.log(`${state.padEnd(6)} ${label} (${detail})`);
}

async function get(path, headers = {}) {
  const res = await fetch(BASE_URL + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res;
}
const expectStatus = (res, status, what) => {
  if (res.status !== status) throw new Error(`${what} : HTTP ${res.status}, attendu ${status}`);
};

let token = null;

await step('GET /v1/health', async () => {
  const res = await get('/v1/health');
  expectStatus(res, 200, '/v1/health');
  const body = await res.json();
  if (body.status !== 'ok' || body.db !== 'ok') throw new Error(`corps inattendu : ${JSON.stringify(body)}`);
  if (!res.headers.get('x-request-id')) throw new Error('en-tete X-Request-Id absent');
});

await step('GET /v1/health/ready (base et migrations)', async () => {
  const res = await get('/v1/health/ready');
  expectStatus(res, 200, '/v1/health/ready');
});

await step('GET /v1/openapi.json (chemins attendus)', async () => {
  const res = await get('/v1/openapi.json');
  expectStatus(res, 200, '/v1/openapi.json');
  const doc = await res.json();
  const missing = EXPECTED_PATHS.filter((p) => !doc.paths?.[p]);
  if (missing.length) throw new Error(`chemins absents : ${missing.join(', ')}`);
  return `${Object.keys(doc.paths).length} chemins`;
});

if (process.env.METRICS_TOKEN) {
  await step('GET /metrics (jeton)', async () => {
    const res = await get('/metrics', { authorization: `Bearer ${process.env.METRICS_TOKEN}` });
    expectStatus(res, 200, '/metrics');
    if (!(await res.text()).includes('http_requests_total')) throw new Error('format Prometheus inattendu');
  });
}

await step('Connexion du compte de test', async () => {
  const { SMOKE_IDENTIFIER: identifier, SMOKE_PASSWORD: password } = process.env;
  if (!identifier || !password) {
    if (process.env.SMOKE_REQUIRE_ACCOUNT === '1') throw new Error('SMOKE_IDENTIFIER / SMOKE_PASSWORD requis');
    return 'skip';
  }
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password, device: { name: 'smoke-test', platform: 'other' } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  expectStatus(res, 200, 'login');
  token = (await res.json()).accessToken;
  if (!token) throw new Error('pas de jeton dans la reponse');
});

await step('GET /v1/me', async () => {
  if (!token) return 'skip';
  const res = await get('/v1/me', { authorization: `Bearer ${token}` });
  expectStatus(res, 200, '/v1/me');
  if (!(await res.json()).id) throw new Error('profil sans id');
});

await step('Catalogue (connecte)', async () => {
  if (!token) return 'skip';
  const res = await get('/v1/products?limit=1', { authorization: `Bearer ${token}` });
  // The commerce module may be switched off by a feature flag on a fresh deployment.
  if (res.status === 403) return 'module commerce desactive';
  expectStatus(res, 200, '/v1/products');
  if (!Array.isArray((await res.json()).items)) throw new Error('liste sans items');
});

await step('Catalogue public de la boutique', async () => {
  const slug = process.env.SMOKE_ORG_SLUG;
  if (!slug) return 'skip';
  const res = await get(`/v1/public/orgs/${encodeURIComponent(slug)}/products`);
  expectStatus(res, 200, 'catalogue public');
});

const failed = results.filter((r) => r[0] === 'ECHEC').length;
console.log(failed === 0 ? `\nRESULTAT : OK (${results.length} etapes)` : `\nRESULTAT : ECHEC (${failed} etape(s) en echec sur ${results.length})`);
process.exitCode = failed === 0 ? 0 : 1;
