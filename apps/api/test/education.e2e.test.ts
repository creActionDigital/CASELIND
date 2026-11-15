import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

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
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}

const course = (extra: Record<string, unknown> = {}) => ({ title: 'Comptabilité de base', description: 'Les fondamentaux', level: 'beginner', language: 'fr', ...extra });
const create = (u: TU, body: Record<string, unknown> = course()) => ctx.http.post('/v1/courses').set(bearer(u.token)).send(body);
const lessons = (u: TU, id: string, n = 2) =>
  ctx.http.put(`/v1/courses/${id}/lessons`).set(bearer(u.token)).send({ lessons: Array.from({ length: n }, (_, i) => ({ title: `Leçon ${i + 1}`, content: `Contenu secret ${i + 1}` })) });
const quiz = (u: TU, id: string, body?: Record<string, unknown>) =>
  ctx.http.put(`/v1/courses/${id}/quiz`).set(bearer(u.token)).send(
    body ?? {
      passPercent: 50,
      questions: [
        { prompt: '2 + 2 ?', options: ['3', '4', '5'], correctIndex: 1 },
        { prompt: 'Capitale de la RDC ?', options: ['Kinshasa', 'Goma'], correctIndex: 0 },
      ],
    },
  );
const publish = (u: TU, id: string) => ctx.http.post(`/v1/courses/${id}/publish`).set(bearer(u.token));
const enroll = (u: TU, id: string) => ctx.http.post(`/v1/courses/${id}/enroll`).set(bearer(u.token));
const complete = (u: TU, id: string, lessonId: string) => ctx.http.post(`/v1/courses/${id}/lessons/${lessonId}/complete`).set(bearer(u.token));
const attempt = (u: TU, id: string, answers: number[]) => ctx.http.post(`/v1/courses/${id}/quiz/attempts`).set(bearer(u.token)).send({ answers });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

/** A published course with two lessons and a two-question quiz. */
async function ready() {
  const teacher = await user();
  const c = (await create(teacher).expect(201)).body;
  await lessons(teacher, c.id).expect(200);
  await quiz(teacher, c.id).expect(200);
  await publish(teacher, c.id).expect(200);
  return { teacher, id: c.id as string };
}

describe('education: authoring (lot 17a)', () => {
  it('needs a session and validates courses, lessons and the quiz', async () => {
    await ctx.http.get('/v1/courses').expect(401);
    const t = await user();
    await create(t, course({ title: 'ab' })).expect(400);
    await create(t, course({ level: 'expert' })).expect(400);
    await create(t, course({ language: 'de' })).expect(400);
    const c = (await create(t).expect(201)).body;
    expect(c).toMatchObject({ status: 'draft', mine: true, lessonCount: 0, questionCount: 0, progressPercent: null });
    await ctx.http.put(`/v1/courses/${c.id}/lessons`).set(bearer(t.token)).send({ lessons: [{ title: '' }] }).expect(400);
    await quiz(t, c.id, { passPercent: 70, questions: [{ prompt: 'Q', options: ['a'], correctIndex: 0 }] }).expect(400); // one option only
    await quiz(t, c.id, { passPercent: 70, questions: [{ prompt: 'Q', options: ['a', 'b'], correctIndex: 2 }] }).expect(400); // answer out of range
    await quiz(t, c.id, { passPercent: 0, questions: [] }).expect(400);
  });

  it('a draft is private, publishing needs a lesson, and only the author edits', async () => {
    const [teacher, other] = [await user(), await user()];
    const c = (await create(teacher).expect(201)).body;
    await ctx.http.get(`/v1/courses/${c.id}`).set(bearer(other.token)).expect(404);
    expect(ids(await ctx.http.get('/v1/courses').set(bearer(other.token)).expect(200))).not.toContain(c.id);
    await lessons(other, c.id).expect(404);
    await ctx.http.patch(`/v1/courses/${c.id}`).set(bearer(other.token)).send({ title: 'Pirate' }).expect(404);
    expect((await publish(teacher, c.id).expect(409)).body.error.details.reason).toBe('course_empty');
    await lessons(teacher, c.id, 1).expect(200);
    const edited = await ctx.http.patch(`/v1/courses/${c.id}`).set(bearer(teacher.token)).send({ title: 'Compta niveau 1' }).expect(200);
    expect(edited.body).toMatchObject({ title: 'Compta niveau 1', description: 'Les fondamentaux', level: 'beginner', lessonCount: 1 }); // untouched fields stay
    await publish(teacher, c.id).expect(200);
    await publish(teacher, c.id).expect(200);
    expect(ids(await ctx.http.get('/v1/courses').set(bearer(other.token)).expect(200))).toContain(c.id);
    await ctx.http.post(`/v1/courses/${c.id}/unpublish`).set(bearer(teacher.token)).expect(200);
    expect(ids(await ctx.http.get('/v1/courses').set(bearer(other.token)).expect(200))).not.toContain(c.id);
    expect(ids(await ctx.http.get('/v1/me/courses').set(bearer(teacher.token)).expect(200))).toContain(c.id);
  });

  it('lists published courses with filters and pages; blocked authors vanish', async () => {
    const [teacher, learner] = [await user(), await user()];
    const a = (await create(teacher, course({ title: 'Anglais 100%', language: 'en', level: 'advanced' })).expect(201)).body;
    const b = (await create(teacher, course({ title: 'Swahili débutant', language: 'sw' })).expect(201)).body;
    for (const c of [a, b]) {
      await lessons(teacher, c.id, 1).expect(200);
      await publish(teacher, c.id).expect(200);
    }
    const list = (qs = '') => ctx.http.get(`/v1/courses${qs}`).set(bearer(learner.token));
    expect(ids(await list('?language=en'))).toContain(a.id);
    expect(ids(await list('?language=en'))).not.toContain(b.id);
    expect(ids(await list('?level=advanced'))).toContain(a.id);
    expect(ids(await list('?q=%25'))).toEqual([a.id]);
    const p1 = await list('?limit=1').expect(200);
    expect(ids(await list(`?limit=1&cursor=${p1.body.nextCursor}`))).not.toEqual(ids(p1));
    await list('?cursor=x').expect(400);
    await ctx.http.put(`/v1/blocks/${learner.id}`).set(bearer(teacher.token)).expect(204);
    expect(ids(await list())).not.toContain(a.id);
    await ctx.http.get(`/v1/courses/${a.id}`).set(bearer(learner.token)).expect(404);
  });
});

describe('education: learning, quiz and certificates (lot 17a)', () => {
  it('hides the lesson text and the answer key until enrolled; the author cannot enroll', async () => {
    const { teacher, id } = await ready();
    const learner = await user();
    const before = (await ctx.http.get(`/v1/courses/${id}`).set(bearer(learner.token)).expect(200)).body;
    expect(before.lessons.map((l: { content: string | null }) => l.content)).toEqual([null, null]); // titles only
    expect(before).toMatchObject({ enrolled: false, progressPercent: null });
    await ctx.http.get(`/v1/courses/${id}/quiz`).set(bearer(learner.token)).expect(404);
    await complete(learner, id, before.lessons[0].id).expect(404);
    await attempt(learner, id, [1, 0]).expect(404);
    await enroll(teacher, id).expect(403);

    const after = (await enroll(learner, id).expect(200)).body;
    expect(after).toMatchObject({ enrolled: true, progressPercent: 0 });
    expect(after.lessons[0].content).toBe('Contenu secret 1');
    await enroll(learner, id).expect(200); // idempotent
    const q = (await ctx.http.get(`/v1/courses/${id}/quiz`).set(bearer(learner.token)).expect(200)).body;
    expect(q.questions).toHaveLength(2);
    expect(JSON.stringify(q)).not.toContain('correct');
    expect(JSON.stringify(await ctx.http.get(`/v1/courses/${id}/quiz`).set(bearer(teacher.token)).expect(200))).not.toContain('correct');
  });

  it('grades attempts, allows retries, and issues the certificate once lessons are done and the quiz is passed', async () => {
    const { id } = await ready();
    const learner = await user();
    const detail = (await enroll(learner, id).expect(200)).body;
    const [l1, l2] = detail.lessons as { id: string }[];

    await attempt(learner, id, [1]).expect(400); // wrong number of answers
    await attempt(learner, id, [1, 9]).expect(400); // option out of range
    const fail = (await attempt(learner, id, [0, 1]).expect(200)).body;
    expect(fail).toMatchObject({ scorePercent: 0, passed: false, correct: 0, total: 2, certificateCode: null });
    const pass = (await attempt(learner, id, [1, 0]).expect(200)).body;
    expect(pass).toMatchObject({ scorePercent: 100, passed: true, certificateCode: null }); // lessons still to do

    expect((await complete(learner, id, l1!.id).expect(200)).body.progressPercent).toBe(50);
    await complete(learner, id, l1!.id).expect(200); // idempotent
    await complete(learner, id, '00000000-0000-4000-8000-000000000000').expect(404);
    const done = (await complete(learner, id, l2!.id).expect(200)).body;
    expect(done).toMatchObject({ progressPercent: 100, bestScorePercent: 100 });
    expect(done.certificateCode).toMatch(/^[A-Z0-9]{12}$/);

    const certs = (await ctx.http.get('/v1/me/certificates').set(bearer(learner.token)).expect(200)).body.items;
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ code: done.certificateCode, courseTitle: 'Comptabilité de base' });
    const again = (await attempt(learner, id, [1, 0]).expect(200)).body; // a later attempt never issues a second one
    expect(again.certificateCode).toBe(done.certificateCode);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM certificates WHERE user_id = $1', [learner.id])).rows[0].n).toBe(1);
    const mine = (await ctx.http.get('/v1/me/enrollments').set(bearer(learner.token)).expect(200)).body.items;
    expect(mine[0]).toMatchObject({ courseId: id, progressPercent: 100, completed: true, certificateCode: done.certificateCode });
  });

  it('issues the certificate as soon as the lessons are done when the course has no quiz', async () => {
    const teacher = await user();
    const c = (await create(teacher).expect(201)).body;
    await lessons(teacher, c.id, 1).expect(200);
    await publish(teacher, c.id).expect(200);
    const learner = await user();
    const d = (await enroll(learner, c.id).expect(200)).body;
    await ctx.http.get(`/v1/courses/${c.id}/quiz`).set(bearer(learner.token)).expect(404);
    await attempt(learner, c.id, []).expect(404);
    expect((await complete(learner, c.id, d.lessons[0].id).expect(200)).body.certificateCode).toMatch(/^[A-Z0-9]{12}$/);
  });

  it('verifies a certificate publicly with the minimum of data; a wrong code is a plain 404', async () => {
    const teacher = await user();
    const c = (await create(teacher).expect(201)).body;
    await lessons(teacher, c.id, 1).expect(200);
    await publish(teacher, c.id).expect(200);
    const learner = await user();
    const d = (await enroll(learner, c.id).expect(200)).body;
    const code = (await complete(learner, c.id, d.lessons[0].id).expect(200)).body.certificateCode as string;
    const res = await ctx.http.get(`/v1/public/certificates/${code}`).expect(200); // no token
    expect(Object.keys(res.body).sort()).toEqual(['courseTitle', 'holderName', 'issuedAt', 'valid']);
    expect(res.body.valid).toBe(true);
    await ctx.http.get('/v1/public/certificates/AAAAAAAAAAAA').expect(404);
    await ctx.http.get('/v1/public/certificates/short').expect(404);
    await ctx.http.get(`/v1/public/certificates/${code.toLowerCase()}`).expect(404);
  });

  it('freezes lessons and quiz once learners are enrolled, and shows the author progress', async () => {
    const { teacher, id } = await ready();
    const learner = await user();
    const stranger = await user();
    await enroll(learner, id).expect(200);
    expect((await lessons(teacher, id, 3).expect(409)).body.error.details.reason).toBe('course_has_learners');
    await quiz(teacher, id).expect(409);
    const s = (await ctx.http.get(`/v1/courses/${id}/students`).set(bearer(teacher.token)).expect(200)).body;
    expect(s).toMatchObject({ enrolledCount: 1, completedCount: 0, items: [{ progressPercent: 0, completed: false }] });
    await ctx.http.get(`/v1/courses/${id}/students`).set(bearer(learner.token)).expect(404);
    await ctx.http.get(`/v1/courses/${id}/students`).set(bearer(stranger.token)).expect(404);
    await ctx.http.post(`/v1/courses/${id}/unpublish`).set(bearer(teacher.token)).expect(200);
    await ctx.http.get(`/v1/courses/${id}`).set(bearer(learner.token)).expect(200); // enrolled learners keep access
    await enroll(stranger, id).expect(404);
  });

  it('audits without content, exports the account\'s own data, and can be reported, hidden and switched off', async () => {
    const { teacher, id } = await ready();
    const [learner, stranger, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const d = (await enroll(learner, id).expect(200)).body;
    await attempt(learner, id, [1, 0]).expect(200);
    for (const l of d.lessons) await complete(learner, id, l.id).expect(200);

    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'education.%' ORDER BY occurred_at`, [learner.id]);
    expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(['education.enrolled', 'education.quiz_attempted', 'education.certificate_issued']);
    expect(JSON.stringify(audits.rows)).not.toContain('Contenu secret');

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(learner.token)).expect(200)).body.education;
    expect(exp.authored).toEqual([]);
    expect(exp.enrollments).toHaveLength(1);
    expect(exp.enrollments[0]).toMatchObject({ courseTitle: 'Comptabilité de base', completed: true });
    expect((await ctx.http.get('/v1/me/export').set(bearer(teacher.token)).expect(200)).body.education.authored).toHaveLength(1);

    await ctx.http.post('/v1/reports').set(bearer(stranger.token)).send({ targetType: 'course', targetId: id, reason: 'spam' }).expect(201);
    const act = (action: string) => ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'course', targetId: id, action });
    await act('hide').expect(200);
    await ctx.http.get(`/v1/courses/${id}`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/courses/${id}`).set(bearer(teacher.token)).expect(200);
    await act('restore').expect(200);

    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'education'`);
    try {
      await ctx.http.get('/v1/courses').set(bearer(stranger.token)).expect(403);
      await ctx.http.get('/v1/me/certificates').set(bearer(learner.token)).expect(403);
      await ctx.http.get(`/v1/public/certificates/AAAAAAAAAAAA`).expect(404); // the public check stays reachable (404 = unknown code, not 403)
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'education'`);
    }
  });
});
