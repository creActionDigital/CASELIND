import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Sanctions graduées, effets côté serveur, recours, limites d'action, anti-spam (CDC §26). */
let ctx: TestContext;
let env: Env;
beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.app.get<Env>(ENV);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}
const admin = () => user(['user', 'admin']);
const mod = () => user(['user', 'moderator']);
const sanction = (a: TU, target: string, body: Record<string, unknown>) =>
  ctx.http.post(`/v1/admin/users/${target}/sanctions`).set(bearer(a.token)).send({ reason: 'comportement abusif', ...body });
const post = (u: TU) => ctx.http.post('/v1/posts').set(bearer(u.token)).send({ clientId: randomUUID(), body: 'Bonjour', visibility: 'public' });
const status = async (id: string) => (await ctx.sql.query('SELECT status::text AS s FROM users WHERE id = $1', [id])).rows[0].s as string;
const rowOf = async (id: string) => (await ctx.sql.query('SELECT * FROM user_sanctions WHERE id = $1', [id])).rows[0];

describe('blocage de publication', () => {
  it('un compte muet ne peut ni publier, ni commenter, ni poster une story ; la levée rend la parole', async () => {
    const m = await mod();
    const victim = await user();
    const other = await user();
    const p = await post(other).expect(201);

    const s = await sanction(m, victim.id, { kind: 'mute_posting', durationDays: 7 }).expect(201);
    expect(s.body).toMatchObject({ kind: 'mute_posting', status: 'active', userId: victim.id });

    const refused = await post(victim).expect(403);
    expect(refused.body.error.details.reason).toBe('muted');
    await ctx.http.post(`/v1/posts/${p.body.id}/comments`).set(bearer(victim.token)).send({ body: 'salut' }).expect(403);
    await ctx.http.post('/v1/stories').set(bearer(victim.token)).send({ clientId: randomUUID(), mediaId: randomUUID() }).expect(403);
    // Lire reste possible, et les autres publient normalement.
    await ctx.http.get('/v1/me').set(bearer(victim.token)).expect(200);
    await post(other).expect(201);

    // Notification générique, sans motif.
    const n = await ctx.sql.query('SELECT title, body, data FROM notifications WHERE user_id = $1', [victim.id]);
    expect(n.rows).toHaveLength(1);
    expect(JSON.stringify(n.rows[0])).not.toContain('abusif');

    await ctx.http.post(`/v1/admin/sanctions/${s.body.id}/lift`).set(bearer(m.token)).send({}).expect(200);
    await post(victim).expect(201);
  });

  it('la fin du blocage rend la parole sans intervention', async () => {
    const m = await mod();
    const victim = await user();
    const s = await sanction(m, victim.id, { kind: 'mute_posting', durationDays: 30 }).expect(201);
    await post(victim).expect(403);
    await ctx.sql.query(`UPDATE user_sanctions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [s.body.id]);
    await post(victim).expect(201);
    expect((await ctx.http.get('/v1/admin/sanctions').query({ userId: victim.id }).set(bearer(m.token)).expect(200)).body.items[0].status).toBe('expired');
  });
});

describe('suspension temporaire, bannissement', () => {
  it('la suspension coupe le compte et la maintenance la lève à la fin', async () => {
    const a = await admin();
    const victim = await user();
    const s = await sanction(a, victim.id, { kind: 'suspension_temp', durationDays: 2 }).expect(201);
    expect(await status(victim.id)).toBe('suspended');
    await ctx.http.get('/v1/me').set(bearer(victim.token)).expect(401);

    await ctx.app.get(MaintenanceService).runOnce();
    expect(await status(victim.id)).toBe('suspended'); // pas encore échue

    await ctx.sql.query(`UPDATE user_sanctions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [s.body.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await status(victim.id)).toBe('active');
    expect((await rowOf(s.body.id)).status).toBe('expired');
    await ctx.http.get('/v1/me').set(bearer(victim.token)).expect(200);
  });

  it('un bannissement n\'a pas de fin ; seule la levée réactive ; une suspension posée par ailleurs n\'est pas levée par une sanction qui ne l\'a pas causée', async () => {
    const a = await admin();
    const victim = await user();
    const ban = await sanction(a, victim.id, { kind: 'ban' }).expect(201);
    expect(ban.body.endsAt).toBeNull();
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await status(victim.id)).toBe('suspended');
    await ctx.http.post(`/v1/admin/sanctions/${ban.body.id}/lift`).set(bearer(a.token)).send({ note: 'erreur' }).expect(200);
    expect(await status(victim.id)).toBe('active');
    await ctx.http.post(`/v1/admin/sanctions/${ban.body.id}/lift`).set(bearer(a.token)).send({}).expect(409);

    // Suspendu par la gouvernance, puis un avertissement : l'avertissement n'y touche pas.
    const other = await user();
    await ctx.http.put(`/v1/admin/users/${other.id}/status`).set(bearer(a.token)).send({ status: 'suspended', reason: 'fraude' }).expect(204);
    const w = await sanction(a, other.id, { kind: 'suspension_temp', durationDays: 1 }).expect(201);
    await ctx.sql.query(`UPDATE user_sanctions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [w.body.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await status(other.id)).toBe('suspended');
  });
});

describe('recours', () => {
  it('un seul recours par sanction ; le rejet remet la sanction en vigueur ; l\'acceptation la lève', async () => {
    const m = await mod();
    const a = await admin();
    const victim = await user();
    const stranger = await user();
    const s1 = await sanction(m, victim.id, { kind: 'mute_posting', durationDays: 7 }).expect(201);
    const s2 = await sanction(m, victim.id, { kind: 'warning' }).expect(201);

    const mine = await ctx.http.get('/v1/me/sanctions').set(bearer(victim.token)).expect(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items[0].issuedBy).toBeNull();
    expect((await ctx.http.get('/v1/me/sanctions').set(bearer(stranger.token)).expect(200)).body.items).toEqual([]);

    await ctx.http.post(`/v1/me/sanctions/${s1.body.id}/appeal`).set(bearer(stranger.token)).send({ message: 'pas moi' }).expect(404);
    await ctx.http.post(`/v1/me/sanctions/${s1.body.id}/appeal`).set(bearer(victim.token)).send({ message: '' }).expect(400);
    const ap = await ctx.http.post(`/v1/me/sanctions/${s1.body.id}/appeal`).set(bearer(victim.token)).send({ message: 'Je conteste cette mesure.' }).expect(200);
    expect(ap.body.status).toBe('appealed');
    expect(ap.body.appeal.status).toBe('pending');
    const again = await ctx.http.post(`/v1/me/sanctions/${s1.body.id}/appeal`).set(bearer(victim.token)).send({ message: 'encore' }).expect(409);
    expect(again.body.error.details.reason).toBe('already_appealed');
    await post(victim).expect(403); // en attente de décision, la mesure reste en vigueur

    await ctx.http.get('/v1/admin/appeals').set(bearer(victim.token)).expect(403);
    const list = await ctx.http.get('/v1/admin/appeals').query({ status: 'pending' }).set(bearer(m.token)).expect(200);
    const appealId = list.body.items.find((x: { sanctionId: string }) => x.sanctionId === s1.body.id).id;
    expect(list.body.items[0].message).toBeDefined();

    await ctx.http.post(`/v1/admin/appeals/${appealId}/decide`).set(bearer(victim.token)).send({ decision: 'accepted' }).expect(403);
    const rej = await ctx.http.post(`/v1/admin/appeals/${appealId}/decide`).set(bearer(m.token)).send({ decision: 'rejected', note: 'maintenue' }).expect(200);
    expect(rej.body).toMatchObject({ status: 'rejected', sanctionStatus: 'active' });
    await ctx.http.post(`/v1/admin/appeals/${appealId}/decide`).set(bearer(a.token)).send({ decision: 'accepted' }).expect(409);

    // Acceptation sur la seconde (avertissement) : levée.
    await ctx.http.post(`/v1/me/sanctions/${s2.body.id}/appeal`).set(bearer(victim.token)).send({ message: 'Injuste.' }).expect(200);
    const l2 = await ctx.http.get('/v1/admin/appeals').query({ status: 'pending' }).set(bearer(a.token)).expect(200);
    const id2 = l2.body.items.find((x: { sanctionId: string }) => x.sanctionId === s2.body.id).id;
    const acc = await ctx.http.post(`/v1/admin/appeals/${id2}/decide`).set(bearer(a.token)).send({ decision: 'accepted' }).expect(200);
    expect(acc.body).toMatchObject({ status: 'accepted', sanctionStatus: 'lifted' });
    expect((await rowOf(s2.body.id)).status).toBe('lifted');
    // Une sanction levée ne se conteste plus.
    const s3 = await sanction(m, victim.id, { kind: 'warning' }).expect(201);
    await ctx.http.post(`/v1/admin/sanctions/${s3.body.id}/lift`).set(bearer(m.token)).send({}).expect(200);
    await ctx.http.post(`/v1/me/sanctions/${s3.body.id}/appeal`).set(bearer(victim.token)).send({ message: 'x' }).expect(409);
  });

  it('un recours accepté sur un bannissement réactive le compte (par un administrateur)', async () => {
    const a = await admin();
    const victim = await user();
    const ban = await sanction(a, victim.id, { kind: 'suspension_temp', durationDays: 3 }).expect(201);
    // Le compte suspendu ne peut pas appeler l'API : le recours est déposé en base comme le ferait un guichet de support.
    await ctx.sql.query(`INSERT INTO sanction_appeals (sanction_id, user_id, message) VALUES ($1, $2, 'svp')`, [ban.body.id, victim.id]);
    await ctx.sql.query(`UPDATE user_sanctions SET status = 'appealed' WHERE id = $1`, [ban.body.id]);
    const id = (await ctx.http.get('/v1/admin/appeals').query({ status: 'pending' }).set(bearer(a.token)).expect(200)).body.items.find((x: { sanctionId: string }) => x.sanctionId === ban.body.id).id;
    const m = await mod();
    await ctx.http.post(`/v1/admin/appeals/${id}/decide`).set(bearer(m.token)).send({ decision: 'accepted' }).expect(403); // suspension : administrateur seulement
    await ctx.http.post(`/v1/admin/appeals/${id}/decide`).set(bearer(a.token)).send({ decision: 'accepted' }).expect(200);
    expect(await status(victim.id)).toBe('active');
  });
});

describe('limites d\'action et droits', () => {
  it('droits : un utilisateur n\'a aucun accès ; un modérateur ne suspend ni ne bannit, ni ne touche le personnel', async () => {
    const m = await mod();
    const plain = await user();
    const victim = await user();
    const staff = await user(['user', 'support']);
    await sanction(plain, victim.id, { kind: 'warning' }).expect(403);
    await ctx.http.get('/v1/admin/sanctions').set(bearer(plain.token)).expect(403);
    await sanction(m, victim.id, { kind: 'ban' }).expect(403);
    await sanction(m, victim.id, { kind: 'suspension_temp', durationDays: 1 }).expect(403);
    await sanction(m, staff.id, { kind: 'warning' }).expect(403);
    await sanction(m, victim.id, { kind: 'warning' }).expect(201);
    // Validation : durées par type.
    await sanction(m, victim.id, { kind: 'mute_posting', durationDays: 3 }).expect(400);
    await sanction(m, victim.id, { kind: 'warning', durationDays: 3 }).expect(400);
    await sanction(m, 'pas-un-uuid', { kind: 'warning' }).expect(404);
    // Un modérateur ne lève pas un bannissement.
    const a = await admin();
    const ban = await sanction(a, victim.id, { kind: 'ban' }).expect(201);
    await ctx.http.post(`/v1/admin/sanctions/${ban.body.id}/lift`).set(bearer(m.token)).send({}).expect(403);
  });

  it('un administrateur ne se sanctionne pas lui-même, ni un autre administrateur sans double validation ; toute sanction est auditée sans le motif', async () => {
    const a = await admin();
    const b = await admin();
    expect((await sanction(a, a.id, { kind: 'warning' }).expect(409)).body.error.details.reason).toBe('self');
    expect((await sanction(a, b.id, { kind: 'warning' }).expect(409)).body.error.details.reason).toBe('target_is_admin');
    expect(await status(b.id)).toBe('active');

    const victim = await user();
    const s = await sanction(a, victim.id, { kind: 'warning', reportId: undefined }).expect(201);
    const ev = await ctx.sql.query(`SELECT actor_user_id, subject_user_id, metadata FROM audit_events WHERE action = 'admin.sanction_issued' AND subject_user_id = $1`, [victim.id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].actor_user_id).toBe(a.id);
    expect(ev.rows[0].metadata).toEqual({ sanctionId: s.body.id, kind: 'warning' });
    await ctx.http.post(`/v1/admin/sanctions/${s.body.id}/lift`).set(bearer(a.token)).send({}).expect(200);
    expect(Number((await ctx.sql.query(`SELECT count(*) FROM audit_events WHERE action = 'admin.sanction_lifted'`)).rows[0].count)).toBeGreaterThan(0);
  });

  it('double validation : un administrateur ou un ban du personnel attend un second administrateur ; on ne lève pas sa propre sanction', async () => {
    const a = await admin();
    const b = await admin();
    const staff = await user(['user', 'moderator']);
    env.ADMIN_DUAL_APPROVAL = 'true';
    const pending = await sanction(a, b.id, { kind: 'warning' }).expect(202);
    expect(pending.body.status).toBe('pending');
    await sanction(a, staff.id, { kind: 'ban' }).expect(202);
    expect(await status(staff.id)).toBe('active');
    // Une suspension de 7 jours au plus visant le personnel passe directement.
    const short = await sanction(a, staff.id, { kind: 'suspension_temp', durationDays: 7 }).expect(201);
    await ctx.http.post(`/v1/admin/sanctions/${short.body.id}/lift`).set(bearer(a.token)).send({}).expect(200);
    await ctx.http.post(`/v1/admin/approvals/${pending.body.approvalId}/approve`).set(bearer(a.token)).expect(403); // pas la sienne
    const c = await admin();
    const list = (await ctx.http.get('/v1/admin/approvals').query({ status: 'pending' }).set(bearer(c.token)).expect(200)).body.items as { id: string; kind: string; subjectId: string }[];
    const forB = list.find((x) => x.kind === 'sanction.issue' && x.subjectId === b.id)!;
    const forStaff = list.find((x) => x.kind === 'sanction.issue' && x.subjectId === staff.id)!;
    expect(forB).toBeDefined();
    await ctx.http.post(`/v1/admin/approvals/${forB.id}/approve`).set(bearer(c.token)).expect(200);
    await ctx.http.post(`/v1/admin/approvals/${forStaff.id}/approve`).set(bearer(c.token)).expect(200);
    env.ADMIN_DUAL_APPROVAL = undefined;
    expect(await status(staff.id)).toBe('suspended');
    const mineB = (await ctx.http.get('/v1/me/sanctions').set(bearer(b.token)).expect(200)).body.items;
    expect(mineB).toHaveLength(1);
    // b ne lève pas sa propre sanction ; c (un autre administrateur) le peut.
    expect((await ctx.http.post(`/v1/admin/sanctions/${mineB[0].id}/lift`).set(bearer(b.token)).send({}).expect(409)).body.error.details.reason).toBe('self');
    await ctx.http.post(`/v1/admin/sanctions/${mineB[0].id}/lift`).set(bearer(c.token)).send({}).expect(200);
  });
});

describe('export et anti-spam', () => {
  it('l\'export du compte contient ses sanctions et son recours', async () => {
    const m = await mod();
    const victim = await user();
    const s = await sanction(m, victim.id, { kind: 'warning' }).expect(201);
    await ctx.http.post(`/v1/me/sanctions/${s.body.id}/appeal`).set(bearer(victim.token)).send({ message: 'Je conteste.' }).expect(200);
    const exp = await ctx.http.get('/v1/me/export').set(bearer(victim.token)).expect(200);
    expect(exp.body.sanctions).toHaveLength(1);
    expect(exp.body.sanctions[0]).toMatchObject({ kind: 'warning', status: 'appealed', appeal: { message: 'Je conteste.', status: 'pending' } });
  });

  it('au-delà de la limite horaire : 429 avec Retry-After, par utilisateur', async () => {
    const saved = [env.ANTISPAM_POSTS_PER_HOUR, env.ANTISPAM_COMMENTS_PER_HOUR];
    env.ANTISPAM_POSTS_PER_HOUR = 2;
    env.ANTISPAM_COMMENTS_PER_HOUR = 1;
    try {
      const u = await user();
      const v = await user();
      await post(u).expect(201);
      await post(u).expect(201);
      const refused = await post(u).expect(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.body.error.code).toBe('rate_limited');
      const p = await post(v).expect(201);
      await ctx.http.post(`/v1/posts/${p.body.id}/comments`).set(bearer(u.token)).send({ body: 'a' }).expect(201);
      const c = await ctx.http.post(`/v1/posts/${p.body.id}/comments`).set(bearer(u.token)).send({ body: 'b' }).expect(429);
      expect(c.headers['retry-after']).toBeDefined();
    } finally {
      [env.ANTISPAM_POSTS_PER_HOUR, env.ANTISPAM_COMMENTS_PER_HOUR] = saved as [number, number];
    }
  });
});
