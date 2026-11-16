import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
const setFlag = (enabled: boolean) => ctx.sql.query(`UPDATE feature_flags SET enabled = $1 WHERE key = 'school'`, [enabled]);

interface TU {
  token: string;
  id: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}
let n = 0;
async function org(owner: TU, kind: string, name: string, city: string): Promise<string> {
  n += 1;
  const id = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `bourse-${Date.now().toString(36)}-${n}`, name, kind }).expect(201)).body.id;
  await ctx.sql.query(`UPDATE organizations SET city = $2 WHERE id = $1`, [id, city]);
  return id;
}
const call = (method: 'get' | 'post', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});

describe('school search and scholarships (lot 17e)', () => {
  it('is off by default (regulated flag)', async () => {
    const u = await user();
    expect((await call('get', u, '/schools')).body.error.code).toBe('feature_disabled');
    expect((await call('get', u, '/school/scholarships')).body.error.code).toBe('feature_disabled');
  });

  describe('with the module on', () => {
    beforeAll(() => setFlag(true));
    afterAll(() => setFlag(false));

    it('searches public active schools only, with public fields only', async () => {
      const [head, reader] = [await user(), await user()];
      const tag = `Zorbix${Date.now().toString(36)}`;
      const a = await org(head, 'school', `Lycee ${tag} A`, 'Kinshasa');
      const b = await org(head, 'school', `Lycee ${tag} B`, 'Lubumbashi');
      const priv = await org(head, 'school', `Lycee ${tag} Prive`, 'Kinshasa');
      const susp = await org(head, 'school', `Lycee ${tag} Suspendu`, 'Kinshasa');
      await org(head, 'shop', `Boutique ${tag}`, 'Kinshasa');
      await ctx.sql.query(`UPDATE organizations SET visibility = 'private' WHERE id = $1`, [priv]);
      await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp]);
      await ctx.sql.query(`UPDATE organizations SET verification_status = 'verified' WHERE id = $1`, [a]);
      await call('post', head, `/orgs/${a}/school/classes`, { name: 'Secret 6e', yearLabel: '2026' }).expect(201);

      const all = (await call('get', reader, `/schools?q=${tag}`).expect(200)).body;
      expect(all.items.map((s: { id: string }) => s.id).sort()).toEqual([a, b].sort());
      expect(all.items.find((s: { id: string }) => s.id === a)).toMatchObject({ verified: true, city: 'Kinshasa' });
      expect(all.items.find((s: { id: string }) => s.id === b).verified).toBe(false);
      expect(JSON.stringify(all)).not.toMatch(/Secret|class/i);
      expect((await call('get', reader, `/schools?q=${tag}&city=kinshasa`).expect(200)).body.items.map((s: { id: string }) => s.id)).toEqual([a]);
      const p1 = (await call('get', reader, `/schools?q=${tag}&limit=1`).expect(200)).body;
      expect(p1.items).toHaveLength(1);
      const p2 = (await call('get', reader, `/schools?q=${tag}&limit=1&cursor=${p1.nextCursor}`).expect(200)).body;
      expect(p2.items).toHaveLength(1);
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
      await call('get', reader, '/schools?cursor=zzz').expect(400);
    });

    it('staff publish and close; readers see open ones of public schools', async () => {
      const [head, outsider, reader] = [await user(), await user(), await user()];
      const shop = await org(head, 'shop', 'Boutique', 'Goma');
      const school = await org(head, 'school', 'Ecole Bourse', 'Goma');
      await call('post', head, `/orgs/${shop}/school/scholarships`, { title: 'x', description: 'y' }).expect(409);
      await call('post', outsider, `/orgs/${school}/school/scholarships`, { title: 'x', description: 'y' }).expect(404);
      await call('post', head, `/orgs/${school}/school/scholarships`, { title: 'x', description: 'y', url: 'http://nope.example' }).expect(400);
      await call('post', head, `/orgs/${school}/school/scholarships`, { title: 'x', description: 'y'.repeat(2001) }).expect(400);

      const open = (await call('post', head, `/orgs/${school}/school/scholarships`, { title: 'Bourse Excellence', description: 'Pour les meilleurs', deadline: '2999-12-31', url: 'https://ecole.example/bourse' }).expect(201)).body;
      expect(open).toMatchObject({ status: 'open', deadline: '2999-12-31', school: { id: school, city: 'Goma', verified: false } });
      const noUrl = (await call('post', head, `/orgs/${school}/school/scholarships`, { title: 'Bourse Libre', description: 'Sans date' }).expect(201)).body;
      expect(noUrl).toMatchObject({ deadline: null, url: null });
      const expired = (await call('post', head, `/orgs/${school}/school/scholarships`, { title: 'Bourse Passee', description: 'Trop tard', deadline: '2000-01-01' }).expect(201)).body;

      const ids = async (path: string) => (await call('get', reader, path).expect(200)).body.items.map((s: { id: string }) => s.id);
      const seen = await ids('/school/scholarships?city=goma');
      expect(seen).toEqual(expect.arrayContaining([open.id, noUrl.id]));
      expect(seen).not.toContain(expired.id);
      expect((await call('get', reader, `/school/scholarships/${open.id}`).expect(200)).body.title).toBe('Bourse Excellence');
      await call('get', reader, '/school/scholarships/not-a-uuid').expect(404);

      await call('post', outsider, `/orgs/${school}/school/scholarships/${open.id}/close`).expect(404);
      await call('post', head, `/orgs/${school}/school/scholarships/${open.id}/close`).expect(204);
      await call('post', head, `/orgs/${shop}/school/scholarships/${noUrl.id}/close`).expect(404); // not that org's
      expect(await ids('/school/scholarships?city=goma')).not.toContain(open.id);
      const mine = (await call('get', head, `/orgs/${school}/school/scholarships`).expect(200)).body.items;
      expect(mine.find((s: { id: string }) => s.id === open.id).status).toBe('closed');
      await call('get', outsider, `/orgs/${school}/school/scholarships`).expect(404);

      await ctx.sql.query(`UPDATE organizations SET visibility = 'private' WHERE id = $1`, [school]);
      expect(await ids('/school/scholarships?city=goma')).not.toContain(noUrl.id);
      await call('get', reader, `/school/scholarships/${noUrl.id}`).expect(404);

      const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'school.scholarship%'`);
      expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['school.scholarship_published', 'school.scholarship_closed']));
      expect(audits.rows.map((r: { md: string }) => r.md).join('')).not.toMatch(/Excellence|meilleurs|ecole\.example/);
    });
  });
});
