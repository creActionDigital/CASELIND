import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Annonces de la plateforme : audience filtrée côté serveur, période, notification générique (CDC §26). */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
}
async function user(roles?: string[], country?: string): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  if (country) await ctx.sql.query('UPDATE users SET country = $1 WHERE id = $2', [country, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const create = (a: TU, body: Record<string, unknown>) => ctx.http.post('/v1/admin/announcements').set(bearer(a.token)).send({ title: 'Maintenance', body: 'Coupure samedi.', endsAt: day(1), ...body });
const visible = async (u: TU) => (await ctx.http.get('/v1/announcements').set(bearer(u.token)).expect(200)).body.items.map((x: { title: string }) => x.title) as string[];
const notified = async (u: TU, id: string) =>
  Number((await ctx.sql.query(`SELECT count(*) FROM notifications WHERE user_id = $1 AND data->>'announcementId' = $2`, [u.id, id])).rows[0].count);

describe('annonces', () => {
  it('réservé aux administrateurs ; un brouillon est invisible, modifiable, supprimable', async () => {
    const a = await user(['user', 'admin']);
    const u = await user();
    await ctx.http.post('/v1/admin/announcements').set(bearer(u.token)).send({ title: 'x', body: 'y', endsAt: day(1) }).expect(403);
    await ctx.http.get('/v1/admin/announcements').set(bearer(u.token)).expect(403);
    await create(a, { title: '' }).expect(400);
    await create(a, { title: 'x'.repeat(81) }).expect(400);
    await create(a, { body: 'x'.repeat(501) }).expect(400);
    await create(a, { audience: 'role:chef' }).expect(400);
    await create(a, { audience: 'country:cd' }).expect(400);
    await create(a, { startsAt: day(2), endsAt: day(1) }).expect(400);

    const d = (await create(a, { title: 'Brouillon' }).expect(201)).body;
    expect(d).toMatchObject({ status: 'draft', audience: 'all' });
    expect(await visible(u)).not.toContain('Brouillon');
    const up = await ctx.http.patch(`/v1/admin/announcements/${d.id}`).set(bearer(a.token)).send({ title: 'Brouillon 2' }).expect(200);
    expect(up.body.title).toBe('Brouillon 2');
    await ctx.http.patch(`/v1/admin/announcements/${d.id}`).set(bearer(a.token)).send({}).expect(400);
    await ctx.http.delete(`/v1/admin/announcements/${d.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.post(`/v1/admin/announcements/${d.id}/publish`).set(bearer(a.token)).expect(404);
  });

  it('publication : visible pour son audience seulement, une notification générique par destinataire, une seule fois', async () => {
    const a = await user(['user', 'admin']);
    const plain = await user(['user'], 'FR');
    const cd = await user(['user'], 'CD');
    const mod = await user(['user', 'moderator'], 'FR');

    const all = (await create(a, { title: 'Pour tous' }).expect(201)).body;
    const onlyMod = (await create(a, { title: 'Pour modérateurs', audience: 'role:moderator' }).expect(201)).body;
    const onlyCd = (await create(a, { title: 'Pour le Congo', audience: 'country:CD' }).expect(201)).body;
    for (const x of [all, onlyMod, onlyCd]) await ctx.http.post(`/v1/admin/announcements/${x.id}/publish`).set(bearer(a.token)).expect(200);
    await ctx.http.post(`/v1/admin/announcements/${all.id}/publish`).set(bearer(a.token)).expect(409);

    expect(await visible(plain)).toEqual(['Pour tous']);
    expect((await visible(cd)).sort()).toEqual(['Pour le Congo', 'Pour tous']);
    expect((await visible(mod)).sort()).toEqual(['Pour modérateurs', 'Pour tous']);

    expect(await notified(plain, all.id)).toBe(1);
    expect(await notified(plain, onlyCd.id)).toBe(0);
    expect(await notified(cd, onlyCd.id)).toBe(1);
    expect(await notified(mod, onlyMod.id)).toBe(1);
    expect(await notified(plain, onlyMod.id)).toBe(0);
    const n = await ctx.sql.query(`SELECT title, body, category FROM notifications WHERE user_id = $1 AND data->>'announcementId' = $2`, [plain.id, all.id]);
    expect(n.rows[0]).toMatchObject({ body: 'Nouvelle annonce', category: 'system' });

    // La maintenance ne renvoie pas une seconde notification.
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await notified(plain, all.id)).toBe(1);

    // Pagination à curseur.
    const p1 = (await ctx.http.get('/v1/announcements').query({ limit: 1 }).set(bearer(cd.token)).expect(200)).body;
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await ctx.http.get('/v1/announcements').query({ limit: 1, cursor: p1.nextCursor }).set(bearer(cd.token)).expect(200)).body;
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);

    // Terminer retire l'annonce.
    await ctx.http.post(`/v1/admin/announcements/${all.id}/end`).set(bearer(a.token)).expect(200);
    expect(await visible(plain)).toEqual([]);
    await ctx.http.post(`/v1/admin/announcements/${all.id}/end`).set(bearer(a.token)).expect(409);
    expect(Number((await ctx.sql.query(`SELECT count(*) FROM audit_events WHERE action = 'admin.announcement_changed'`)).rows[0].count)).toBeGreaterThanOrEqual(6);
  });

  it('période : une annonce future n\'est ni visible ni notifiée avant son début ; une période échue disparaît', async () => {
    const a = await user(['user', 'admin']);
    const u = await user(['user']);
    const f = (await create(a, { title: 'Bientôt', startsAt: day(1), endsAt: day(2) }).expect(201)).body;
    await ctx.http.post(`/v1/admin/announcements/${f.id}/publish`).set(bearer(a.token)).expect(200);
    expect(await visible(u)).not.toContain('Bientôt');
    expect(await notified(u, f.id)).toBe(0);

    // Le début arrive : la maintenance notifie ; l'annonce devient lisible.
    await ctx.sql.query(`UPDATE platform_announcements SET starts_at = now() - interval '1 minute' WHERE id = $1`, [f.id]);
    expect(await visible(u)).toContain('Bientôt');
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await notified(u, f.id)).toBe(1);

    // La fin passe : elle disparaît même avant la maintenance, puis devient « ended ».
    await ctx.sql.query(`UPDATE platform_announcements SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' WHERE id = $1`, [f.id]);
    expect(await visible(u)).not.toContain('Bientôt');
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query('SELECT status FROM platform_announcements WHERE id = $1', [f.id])).rows[0].status).toBe('ended');

    const old = (await create(a, { title: 'Périmée' }).expect(201)).body;
    await ctx.sql.query(`UPDATE platform_announcements SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = $1`, [old.id]);
    await ctx.http.post(`/v1/admin/announcements/${old.id}/publish`).set(bearer(a.token)).expect(409);
  });
});
