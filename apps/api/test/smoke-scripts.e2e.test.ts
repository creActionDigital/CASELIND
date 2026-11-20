import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

const run = promisify(execFile);
const script = (name: string) => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url));

let ctx: TestContext;
let baseUrl: string;
let identifier: string;
beforeAll(async () => {
  ctx = await createTestContext({ METRICS_TOKEN: 'metrics-token-0123456789abcdef' });
  await ctx.app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  identifier = (await signUp(ctx)).identifier;
});
afterAll(async () => {
  await ctx.close();
});

const node = (file: string, env: Record<string, string>) =>
  run(process.execPath, [script(file)], { env: { ...process.env, ...env } }).then(
    (r) => ({ code: 0, out: r.stdout }),
    (e: { code: number; stdout: string }) => ({ code: e.code, out: e.stdout }),
  );

describe('deployment smoke test and load script (scripts/)', () => {
  it('smoke: every step passes against a live instance', async () => {
    const r = await node('smoke/smoke.mjs', {
      BASE_URL: baseUrl,
      SMOKE_IDENTIFIER: identifier,
      SMOKE_PASSWORD: PASSWORD,
      SMOKE_REQUIRE_ACCOUNT: '1',
      METRICS_TOKEN: 'metrics-token-0123456789abcdef',
    });
    expect(r.out).toContain('RESULTAT : OK');
    expect(r.out).not.toContain('ECHEC');
    expect(r.code).toBe(0);
  });

  it('smoke: exits 1 when a step fails (wrong password)', async () => {
    const r = await node('smoke/smoke.mjs', { BASE_URL: baseUrl, SMOKE_IDENTIFIER: identifier, SMOKE_PASSWORD: 'wrong-password-xyz' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ECHEC\s+Connexion/);
  });

  it('load: short run reports percentiles; an impossible threshold gives exit 1', async () => {
    const env = { BASE_URL: baseUrl, ACCOUNTS: `${identifier}:${PASSWORD}`, USERS: '2', DURATION_S: '2', RAMP_S: '0', THINK_MS: '50', JSON: '1' };
    const ok = await node('load/api-load.mjs', { ...env, P95_MS: '60000', ERROR_RATE: '1' });
    const report = JSON.parse(ok.out);
    expect(report.total.count).toBeGreaterThan(5);
    expect(report.total.p95).toBeGreaterThan(0);
    expect(ok.code).toBe(0);
    const ko = await node('load/api-load.mjs', { ...env, P95_MS: '0' });
    expect(ko.code).toBe(1);
  });
});
