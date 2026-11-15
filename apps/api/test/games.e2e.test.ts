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
const api = (method: 'get' | 'post' | 'patch', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});
const start = (u: TU) => api('post', u, '/games/quiz/sessions');
const submit = (u: TU, id: string, answers: number[]) => api('post', u, `/games/quiz/sessions/${id}/answers`, { answers });

/** Gives the quiz 10 active questions (answer = option 1 for all) so it can start; other tests' questions are retired first. */
async function seedQuestions(count = 10): Promise<void> {
  await ctx.sql.query('DELETE FROM game_sessions');
  await ctx.sql.query('DELETE FROM game_questions');
  for (let i = 0; i < count; i += 1) {
    await ctx.sql.query(`INSERT INTO game_questions (prompt, options, correct_index) VALUES ($1, '["a","b","c"]'::jsonb, 1)`, [`Question ${i}`]);
  }
}
const correctAnswers = () => Array.from({ length: 10 }, () => 1);

describe('quiz éclair (lot 20a)', () => {
  it('is on by default, needs a session, and needs 10 active questions', async () => {
    await ctx.http.post('/v1/games/quiz/sessions').expect(401);
    await seedQuestions(9);
    const u = await user();
    expect((await start(u).expect(409)).body.error.details.reason).toBe('not_enough_questions');
    await seedQuestions(10);
    await start(u).expect(201);
  });

  it('only an administrator manages the questions; the right answer never reaches a player before grading', async () => {
    await seedQuestions(10);
    const [admin, player] = [await user(['user', 'admin']), await user()];
    const q = { prompt: 'Capitale de la RDC ?', options: ['Kinshasa', 'Goma'], correctIndex: 0, category: 'géographie' };
    await api('post', player, '/admin/games/questions', q).expect(403);
    await api('post', admin, '/admin/games/questions', { ...q, options: ['seule'] }).expect(400);
    await api('post', admin, '/admin/games/questions', { ...q, correctIndex: 2 }).expect(400);
    const created = (await api('post', admin, '/admin/games/questions', q).expect(201)).body;
    expect(created).toMatchObject({ correctIndex: 0, active: true });
    expect((await api('get', admin, '/admin/games/questions').expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(created.id);
    await api('get', player, '/admin/games/questions').expect(403);
    expect((await api('patch', admin, `/admin/games/questions/${created.id}`, { active: false }).expect(200)).body.active).toBe(false);
    await api('patch', admin, '/admin/games/questions/00000000-0000-4000-8000-000000000000', { active: true }).expect(404);

    const s = (await start(player).expect(201)).body;
    expect(s.questions).toHaveLength(10);
    expect(JSON.stringify(s)).not.toContain('correct');
    expect(new Date(s.expiresAt).getTime() - Date.now()).toBeGreaterThan(100_000);
    expect(new Set(s.questions.map((x: { id: string }) => x.id)).size).toBe(10);
  });

  it('grades on the server: 100 per right answer plus the seconds left; nothing right scores 0; once only', async () => {
    await seedQuestions(10);
    const [a, b, c] = [await user(), await user(), await user()];
    const sa = (await start(a).expect(201)).body;
    await submit(a, sa.id, [1, 1]).expect(400); // not 10 answers
    await submit(a, sa.id, [1, 1, 1, 1, 1, 1, 1, 1, 1, 7]).expect(400); // an option that does not exist
    const full = (await submit(a, sa.id, correctAnswers()).expect(200)).body;
    expect(full).toMatchObject({ correct: 10, total: 10 });
    expect(full.score).toBeGreaterThanOrEqual(1000);
    expect(full.score).toBeLessThanOrEqual(1120);
    expect((await submit(a, sa.id, correctAnswers()).expect(409)).body.error.details.reason).toBe('already_finished');

    const sb = (await start(b).expect(201)).body;
    const half = (await submit(b, sb.id, [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]).expect(200)).body;
    expect(half).toMatchObject({ correct: 5 });
    expect(half.score).toBeGreaterThanOrEqual(500);
    expect(half.score).toBeLessThan(full.score);

    const sc = (await start(c).expect(201)).body;
    expect((await submit(c, sc.id, Array.from({ length: 10 }, () => 0)).expect(200)).body).toEqual({ correct: 0, total: 10, score: 0 });
  });

  it('keeps sessions private and refuses a late answer', async () => {
    await seedQuestions(10);
    const [a, b] = [await user(), await user()];
    const s = (await start(a).expect(201)).body;
    await submit(b, s.id, correctAnswers()).expect(404);
    await submit(a, 'not-a-uuid', correctAnswers()).expect(404);
    await submit(a, '00000000-0000-4000-8000-000000000000', correctAnswers()).expect(404);
    await ctx.sql.query(`UPDATE game_sessions SET expires_at = now() - interval '5 seconds' WHERE id = $1`, [s.id]);
    expect((await submit(a, s.id, correctAnswers()).expect(409)).body.error.details.reason).toBe('expired');
    expect((await ctx.sql.query('SELECT finished_at FROM game_sessions WHERE id = $1', [s.id])).rows[0].finished_at).toBeNull();
  });

  it('allows 20 games a day, then refuses', async () => {
    await seedQuestions(10);
    const u = await user();
    for (let i = 0; i < 20; i += 1) await start(u).expect(201);
    expect((await start(u).expect(409)).body.error.details).toEqual({ reason: 'daily_limit', max: 20 });
    await ctx.sql.query(`UPDATE game_sessions SET started_at = now() - interval '2 days' WHERE user_id = $1`, [u.id]);
    await start(u).expect(201); // a new day: allowed again
  });

  it('ranks the best finished score of each player, for the week or for ever', async () => {
    await seedQuestions(10);
    const [a, b, c] = [await user(), await user(), await user()];
    const play = async (u: TU, rightCount: number) => {
      const s = (await start(u).expect(201)).body;
      await submit(u, s.id, Array.from({ length: 10 }, (_, i) => (i < rightCount ? 1 : 0))).expect(200);
    };
    await play(a, 4);
    await play(a, 9); // a's best
    await play(b, 6);
    await play(c, 2);
    const board = (await api('get', a, '/games/quiz/leaderboard?period=week').expect(200)).body;
    expect(board.period).toBe('week');
    const mine = board.items.filter((i: { me: boolean }) => i.me);
    expect(mine).toHaveLength(1); // one rank per player
    expect(board.items.map((i: { rank: number }) => i.rank)).toEqual(board.items.map((_: unknown, k: number) => k + 1));
    const scores = board.items.map((i: { bestScore: number }) => i.bestScore);
    expect([...scores].sort((x: number, y: number) => y - x)).toEqual(scores); // best first
    expect(mine[0].bestScore).toBeGreaterThanOrEqual(900);
    expect(board.items.length).toBeLessThanOrEqual(20);

    // An old game counts for "all" but not for "week".
    await ctx.sql.query(`UPDATE game_sessions SET finished_at = now() - interval '30 days' WHERE user_id = $1`, [b.id]);
    const week = (await api('get', c, '/games/quiz/leaderboard?period=week').expect(200)).body.items.map((i: { handle: string }) => i.handle);
    const all = (await api('get', c, '/games/quiz/leaderboard?period=all').expect(200)).body.items.map((i: { handle: string }) => i.handle);
    const bHandle = (await ctx.http.get('/v1/me').set(bearer(b.token))).body.handle;
    expect(week).not.toContain(bHandle);
    expect(all).toContain(bHandle);
    await api('get', c, '/games/quiz/leaderboard?period=year').expect(400);
  });

  it('audits only ids and scores, exports the player\'s own finished games, and turns off with the flag', async () => {
    await seedQuestions(10);
    const [u, other] = [await user(), await user()];
    const s = (await start(u).expect(201)).body;
    await submit(u, s.id, correctAnswers()).expect(200);
    const o = (await start(other).expect(201)).body;
    await submit(other, o.id, correctAnswers()).expect(200);
    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'games.%' ORDER BY occurred_at`, [u.id]);
    expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(['games.session_started', 'games.session_finished']);
    expect(JSON.stringify(audits.rows)).not.toContain('Question');

    const exp = (await api('get', u, '/me/export').expect(200)).body.games;
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ correct: 10 });

    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'games'`);
    try {
      expect((await start(u)).status).toBe(403);
      expect((await api('get', u, '/games/quiz/leaderboard')).status).toBe(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'games'`);
    }
  });
});
