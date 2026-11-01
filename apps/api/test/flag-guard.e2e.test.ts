import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequireFlag } from '../src/flags/flag.guard.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Test-only route behind a feature flag, mounted next to the real controllers and global guards. */
@Controller('test-probe')
@RequireFlag('social.stories')
class FlaggedProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

let ctx: TestContext;
let cdToken: string;

beforeAll(async () => {
  ctx = await createTestContext({}, { extraControllers: [FlaggedProbeController] });
  const u = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET country = 'CD' WHERE email = $1`, [u.identifier]);
  cdToken = u.tokens.accessToken;
});
afterAll(async () => {
  await ctx.close();
});

const setCountries = (countries: string[] | null) =>
  ctx.sql.query(`UPDATE feature_flags SET allowed_countries = $1, enabled = true WHERE key = 'social.stories'`, [
    countries,
  ]);

describe('@RequireFlag on a real route (FlagGuard)', () => {
  it('lets the request through when the flag is on for the caller country', async () => {
    await setCountries(['CD']);
    const res = await ctx.http.get('/v1/test-probe').set(bearer(cdToken)).expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('refuses with 403 feature_disabled when the flag excludes the caller country', async () => {
    await setCountries(['KE']);
    const res = await ctx.http.get('/v1/test-probe').set(bearer(cdToken)).expect(403);
    expect(res.body.error.code).toBe('feature_disabled');
  });

  it('refuses with 403 when the flag is switched off', async () => {
    await setCountries(null);
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'social.stories'`);
    const res = await ctx.http.get('/v1/test-probe').set(bearer(cdToken)).expect(403);
    expect(res.body.error.code).toBe('feature_disabled');
  });

  it('runs AuthGuard first: an unauthenticated caller gets 401, not 403, whatever the flag', async () => {
    await setCountries(['CD']);
    const on = await ctx.http.get('/v1/test-probe').expect(401);
    expect(on.body.error.code).not.toBe('feature_disabled');
    await setCountries(['KE']);
    const off = await ctx.http.get('/v1/test-probe').expect(401);
    expect(off.body.error.code).not.toBe('feature_disabled');
  });
});
