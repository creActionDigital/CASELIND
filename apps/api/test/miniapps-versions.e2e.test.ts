import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { manifestFor, miniappKit } from './miniapps-kit.js';

let ctx: TestContext;
const kit = miniappKit(() => ctx);

beforeAll(async () => {
  ctx = await createTestContext({ OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: '1000', MINIAPP_RATE_LIMIT_PER_MINUTE: '1000' });
});
afterAll(async () => {
  await ctx.close();
});

const createVersion = (token: string, appId: string, body: Record<string, unknown>) =>
  ctx.http.post(`/v1/miniapps/${appId}/versions`).set(bearer(token)).send(body);

describe('versions of an application', () => {
  it('lets only the owner create, list and submit; versions are unique and semver', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const stranger = await kit.user();
    await createVersion(dev.owner.token, dev.appId, { version: '1.0' }).expect(400);
    await createVersion(dev.owner.token, dev.appId, { version: '1.0.0-beta' }).expect(400);
    await createVersion(dev.owner.token, dev.appId, { version: '1.0.0', changelog: 'x'.repeat(1001) }).expect(400);
    await createVersion(dev.owner.token, dev.appId, { version: '1.0.0', scopes: ['admin.all'] }).expect(400);

    const v1 = await createVersion(dev.owner.token, dev.appId, { version: '1.0.0', changelog: 'Première version' }).expect(201);
    expect(v1.body).toMatchObject({ version: '1.0.0', status: 'draft', scopes: ['profile.basic'], addedScopes: [] });
    await createVersion(dev.owner.token, dev.appId, { version: '1.0.0' }).expect(409);

    await createVersion(stranger.token, dev.appId, { version: '2.0.0' }).expect(404);
    await ctx.http.get(`/v1/miniapps/${dev.appId}/versions`).set(bearer(stranger.token)).expect(404);
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v1.body.id}/submit`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/miniapps/${dev.appId}/stats`).set(bearer(stranger.token)).expect(404);

    const other = await kit.publishedApp(['profile.basic']);
    await ctx.http.post(`/v1/miniapps/${other.appId}/versions/${v1.body.id}/submit`).set(bearer(other.owner.token)).expect(404);

    const list = await ctx.http.get(`/v1/miniapps/${dev.appId}/versions`).set(bearer(dev.owner.token)).expect(200);
    expect(list.body.items.map((v: { version: string }) => v.version)).toEqual(['1.0.0']);

    const submitted = await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v1.body.id}/submit`).set(bearer(dev.owner.token)).expect(200);
    expect(submitted.body).toMatchObject({ status: 'submitted' });
    expect(submitted.body.submittedAt).toBeTruthy();
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v1.body.id}/submit`).set(bearer(dev.owner.token)).expect(409);

    const mine = await ctx.http.get('/v1/me/miniapps').set(bearer(dev.owner.token)).expect(200);
    expect(mine.body.items.map((a: { id: string }) => a.id)).toEqual([dev.appId]);
    expect((await ctx.http.get('/v1/me/miniapps').set(bearer(stranger.token)).expect(200)).body.items).toEqual([]);
  });

  it('reviews versions with the admin guard; a rejection needs a note and nothing is audited with content', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const mod = await kit.adminUser();
    const v = await createVersion(dev.owner.token, dev.appId, { version: '1.0.0', changelog: 'texte-du-changelog-unique' }).expect(201);
    // A draft cannot be reviewed.
    await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/approve`).set(bearer(mod.token)).send({}).expect(409);
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v.body.id}/submit`).set(bearer(dev.owner.token)).expect(200);

    await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/approve`).set(bearer(dev.owner.token)).send({}).expect(403);
    await ctx.http.get('/v1/admin/miniapps/versions').set(bearer(dev.owner.token)).expect(403);
    const queue = await ctx.http.get('/v1/admin/miniapps/versions').set(bearer(mod.token)).expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(v.body.id);

    await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/reject`).set(bearer(mod.token)).send({}).expect(400);
    const rejected = await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/reject`).set(bearer(mod.token)).send({ note: 'Description manquante' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', reviewNote: 'Description manquante' });
    await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/approve`).set(bearer(mod.token)).send({}).expect(409);

    const audit = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE action LIKE 'miniapp.version_%' AND metadata->>'appId' = $1`, [dev.appId]);
    expect(audit.rows.map((r: { action: string }) => r.action).sort()).toEqual(['miniapp.version_created', 'miniapp.version_reviewed', 'miniapp.version_submitted']);
    expect(JSON.stringify(audit.rows)).not.toContain('texte-du-changelog-unique');
  });

  it('approval makes the version current; added scopes require a new consent, the old consent is untouched', async () => {
    const dev = await kit.publishedApp(['profile.basic']);
    const mod = await kit.adminUser();
    const u = await kit.user();
    const first = await kit.connect(u, dev, ['profile.basic']);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(first.access)).expect(200);
    expect((await ctx.http.get(`/v1/miniapps/${dev.appId}`).set(bearer(u.token)).expect(200)).body.version ?? null).toBeNull();

    const v1 = await createVersion(dev.owner.token, dev.appId, { version: '1.0.0' }).expect(201);
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v1.body.id}/submit`).set(bearer(dev.owner.token)).expect(200);
    await ctx.http.post(`/v1/admin/miniapps/versions/${v1.body.id}/approve`).set(bearer(mod.token)).send({}).expect(200);
    // No added scope: nobody has to consent again.
    expect((await ctx.http.get('/v1/me/miniapp-grants').set(bearer(u.token)).expect(200)).body.items[0].reconsentRequired).toBe(false);

    const v2 = await createVersion(dev.owner.token, dev.appId, { version: '1.1.0', scopes: ['profile.basic', 'orders.read'], manifest: manifestFor(['profile.basic', 'orders.read']) }).expect(201);
    expect(v2.body.addedScopes).toEqual(['orders.read']);
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v2.body.id}/submit`).set(bearer(dev.owner.token)).expect(200);
    const approved = await ctx.http.post(`/v1/admin/miniapps/versions/${v2.body.id}/approve`).set(bearer(mod.token)).send({ note: 'OK' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', addedScopes: [] });

    const versions = await ctx.http.get(`/v1/miniapps/${dev.appId}/versions`).set(bearer(dev.owner.token)).expect(200);
    expect(Object.fromEntries(versions.body.items.map((v: { version: string; status: string }) => [v.version, v.status]))).toEqual({ '1.0.0': 'superseded', '1.1.0': 'approved' });
    expect((await ctx.http.get(`/v1/miniapps/${dev.appId}`).set(bearer(u.token)).expect(200)).body).toMatchObject({ version: '1.1.0', scopes: ['profile.basic', 'orders.read'] });
    expect((await ctx.http.get(`/v1/orgs/${dev.orgId}/miniapps/${dev.appId}`).set(bearer(dev.owner.token)).expect(200)).body).toMatchObject({ currentVersion: '1.1.0' });

    // The grant still covers only what the user consented to, and says a new consent is needed.
    const grants = await ctx.http.get('/v1/me/miniapp-grants').set(bearer(u.token)).expect(200);
    expect(grants.body.items[0]).toMatchObject({ scopes: ['profile.basic'], reconsentRequired: true });
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(first.access)).expect(200);
    await ctx.http.get('/v1/miniapp-api/orders').set(bearer(first.access)).expect(403);

    // Consenting to the new scope clears the flag and unlocks it.
    const again = await kit.connect(u, dev, ['profile.basic', 'orders.read']);
    await ctx.http.get('/v1/miniapp-api/orders').set(bearer(again.access)).expect(200);
    expect((await ctx.http.get('/v1/me/miniapp-grants').set(bearer(u.token)).expect(200)).body.items[0]).toMatchObject({ reconsentRequired: false });
  });

  it('a version that drops a scope stops it at once for existing tokens', async () => {
    const dev = await kit.publishedApp(['profile.basic', 'orders.read']);
    const mod = await kit.adminUser();
    const u = await kit.user();
    const c = await kit.connect(u, dev, ['profile.basic', 'orders.read']);
    await ctx.http.get('/v1/miniapp-api/orders').set(bearer(c.access)).expect(200);
    const v = await createVersion(dev.owner.token, dev.appId, { version: '2.0.0', scopes: ['profile.basic'], manifest: manifestFor(['profile.basic']) }).expect(201);
    await ctx.http.post(`/v1/miniapps/${dev.appId}/versions/${v.body.id}/submit`).set(bearer(dev.owner.token)).expect(200);
    await ctx.http.post(`/v1/admin/miniapps/versions/${v.body.id}/approve`).set(bearer(mod.token)).send({}).expect(200);
    await ctx.http.get('/v1/miniapp-api/orders').set(bearer(c.access)).expect(403);
    await ctx.http.get('/v1/miniapp-api/me').set(bearer(c.access)).expect(200);
  });
});
