import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  QUIZ_QUESTIONS_PER_SESSION,
  type AdminGameQuestion,
  type AdminGameQuestionList,
  type CreateTournamentRequest,
  type GameBadgeList,
  type Tournament,
  type TournamentList,
  type TournamentRanking,
  type CreateGameQuestionRequest,
  type Leaderboard,
  type LeaderboardQuery,
  type GameQuizResult,
  type QuizSession,
  type SubmitQuizAnswersRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_SECONDS = 120;
// shortcut: fixed daily cap against score farming, make it an env setting when operations need to tune it.
const MAX_SESSIONS_PER_DAY = 20;
const LEADERBOARD_SIZE = 20;
// Lot 20c anti-cheat: 10 questions in under 8 seconds is not humanly plausible; 5 such games in a UTC day block new games that day.
const MIN_PLAUSIBLE_SECONDS = 8;
const MAX_SUSPICIOUS_PER_DAY = 5;
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
type TournamentRow = { id: string; title: string; starts_at: Date; ends_at: Date; status: Tournament['status'] };
const toTournament = (r: TournamentRow): Tournament => ({ id: r.id, title: r.title, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), status: r.status });
const TOURNAMENT_COLS = sql`id, title, starts_at, ends_at, CASE WHEN now() < starts_at THEN 'upcoming' WHEN now() < ends_at THEN 'live' ELSE 'ended' END AS status`;
const iso = (d: Date | string) => new Date(d).toISOString();

type QuestionRow = { id: string; prompt: string; options: string[]; correct_index: number; category: string; active: boolean };
const toAdmin = (r: QuestionRow): AdminGameQuestion => ({ id: r.id, prompt: r.prompt, options: r.options, correctIndex: r.correct_index, category: r.category, active: r.active });

/** Quiz éclair: a game of skill graded on the server. No money, no bet; the answer key never leaves the server before grading. */
@Injectable()
export class GamesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---- Players ----------------------------------------------------------------------------------

  /** Ten random active questions and two minutes. At most 20 sessions a day (UTC). */
  async start(userId: string, meta: RequestMeta): Promise<QuizSession> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
      const n = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM game_sessions WHERE user_id = ${userId}::uuid AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
      if ((n.rows[0]?.n ?? 0) >= MAX_SESSIONS_PER_DAY) throw AppError.conflict(`At most ${MAX_SESSIONS_PER_DAY} games a day`, { reason: 'daily_limit', max: MAX_SESSIONS_PER_DAY });
      const sus = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM game_sessions WHERE user_id = ${userId}::uuid AND suspicious AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
      if ((sus.rows[0]?.n ?? 0) >= MAX_SUSPICIOUS_PER_DAY) throw AppError.conflict('Too many implausible games today, try again tomorrow', { reason: 'cooldown' });
      const picked = await tx.execute<{ id: string; prompt: string; options: string[] }>(sql`
        SELECT id, prompt, options FROM game_questions WHERE active ORDER BY random() LIMIT ${QUIZ_QUESTIONS_PER_SESSION}`);
      if (picked.rows.length < QUIZ_QUESTIONS_PER_SESSION) throw AppError.conflict('Not enough questions yet', { reason: 'not_enough_questions' });
      const ids = picked.rows.map((q) => q.id);
      const ins = await tx.execute<{ id: string; expires_at: Date }>(sql`
        INSERT INTO game_sessions (user_id, question_ids, expires_at)
        VALUES (${userId}::uuid, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[], now() + (${SESSION_SECONDS} || ' seconds')::interval)
        RETURNING id, expires_at`);
      const row = ins.rows[0]!;
      await this.audit.record({ action: 'games.session_started', actorUserId: userId, meta, metadata: { sessionId: row.id } }, tx);
      return { id: row.id, expiresAt: iso(row.expires_at), questions: picked.rows };
    });
  }

  /** Grades once, before expiry. Score = 100 per right answer plus the seconds left (0 when nothing is right). */
  async submit(userId: string, sessionId: string, body: SubmitQuizAnswersRequest, meta: RequestMeta): Promise<GameQuizResult> {
    if (!UUID_RE.test(sessionId)) throw AppError.notFound('Game not found');
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<{ question_ids: string[]; finished_at: Date | null; seconds_left: number; elapsed: number }>(sql`
        SELECT question_ids, finished_at, extract(epoch FROM (now() - started_at))::float8 AS elapsed, floor(extract(epoch FROM (expires_at - now())))::int AS seconds_left
        FROM game_sessions WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
      const s = res.rows[0];
      if (!s) throw AppError.notFound('Game not found');
      if (s.finished_at) throw AppError.conflict('This game is already finished', { reason: 'already_finished' });
      if (s.seconds_left < 0) throw AppError.conflict('Time is up', { reason: 'expired' });
      const keys = await tx.execute<{ id: string; correct_index: number; n: number }>(sql`
        SELECT id, correct_index, jsonb_array_length(options)::int AS n FROM game_questions WHERE id IN (${sql.join(s.question_ids.map((q) => sql`${q}::uuid`), sql`, `)})`);
      const byId = new Map(keys.rows.map((k) => [k.id, k]));
      let correct = 0;
      for (const [i, qid] of s.question_ids.entries()) {
        const key = byId.get(qid);
        const answer = body.answers[i]!;
        if (key && answer >= key.n) throw invalid('answers', 'an answer points to an option that does not exist');
        if (key && answer === key.correct_index) correct += 1;
      }
      const suspicious = Number(s.elapsed) < MIN_PLAUSIBLE_SECONDS;
      const score = suspicious || correct === 0 ? 0 : correct * 100 + s.seconds_left;
      await tx.execute(sql`UPDATE game_sessions SET finished_at = now(), correct_count = ${correct}, score = ${score}, suspicious = ${suspicious} WHERE id = ${sessionId}::uuid`);
      await this.audit.record({ action: 'games.session_finished', actorUserId: userId, meta, metadata: { sessionId, score, suspicious } }, tx);
      return { correct, total: s.question_ids.length, score, counted: !suspicious };
    });
  }

  /** The best finished score of each player, best first. `week` = the last 7 days. */
  async leaderboard(viewerId: string, q: LeaderboardQuery): Promise<Leaderboard> {
    const since = q.period === 'week' ? sql`AND s.finished_at > now() - interval '7 days'` : sql``;
    const res = await this.db.execute<{ display_name: string; handle: string; best: number; user_id: string }>(sql`
      SELECT u.display_name, u.handle::text AS handle, b.best, b.user_id
      FROM (SELECT s.user_id, max(s.score)::int AS best FROM game_sessions s WHERE s.finished_at IS NOT NULL AND NOT s.suspicious ${since} GROUP BY s.user_id) b
      JOIN users u ON u.id = b.user_id
      ORDER BY b.best DESC, u.handle LIMIT ${LEADERBOARD_SIZE}`);
    return { period: q.period, items: res.rows.map((r, i) => ({ rank: i + 1, displayName: r.display_name, handle: r.handle, bestScore: r.best, me: r.user_id === viewerId })) };
  }

  /** Badges earned by playing; derived from the finished games, nothing is stored. */
  async badges(userId: string): Promise<GameBadgeList> {
    const r = await this.db.execute<{ played: number; perfect: number }>(sql`
      SELECT count(*)::int AS played, count(*) FILTER (WHERE correct_count = ${QUIZ_QUESTIONS_PER_SESSION} AND NOT suspicious)::int AS perfect
      FROM game_sessions WHERE user_id = ${userId}::uuid AND finished_at IS NOT NULL`);
    const { played, perfect } = r.rows[0]!;
    const b = (key: 'first_game' | 'ten_games' | 'perfect', progress: number, target: number) => ({ key, earned: progress >= target, progress: Math.min(progress, target), target });
    return { items: [b('first_game', played, 1), b('ten_games', played, 10), b('perfect', perfect, 1)] };
  }

  async listTournaments(): Promise<TournamentList> {
    const res = await this.db.execute<TournamentRow>(sql`SELECT ${TOURNAMENT_COLS} FROM game_tournaments ORDER BY ends_at DESC, id LIMIT 50`);
    return { items: res.rows.map(toTournament) };
  }

  /** Best finished score of each player inside the window, best first. */
  async tournamentRanking(viewerId: string, id: string): Promise<TournamentRanking> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Tournament not found');
    const t = await this.db.execute<TournamentRow>(sql`SELECT ${TOURNAMENT_COLS} FROM game_tournaments WHERE id = ${id}::uuid`);
    if (!t.rows[0]) throw AppError.notFound('Tournament not found');
    const res = await this.db.execute<{ display_name: string; handle: string; best: number; user_id: string }>(sql`
      SELECT u.display_name, u.handle::text AS handle, b.best, b.user_id
      FROM (SELECT s.user_id, max(s.score)::int AS best FROM game_sessions s, game_tournaments g
            WHERE g.id = ${id}::uuid AND NOT s.suspicious AND s.finished_at >= g.starts_at AND s.finished_at < g.ends_at GROUP BY s.user_id) b
      JOIN users u ON u.id = b.user_id
      ORDER BY b.best DESC, u.handle LIMIT ${LEADERBOARD_SIZE}`);
    return { tournament: toTournament(t.rows[0]), items: res.rows.map((r, i) => ({ rank: i + 1, displayName: r.display_name, handle: r.handle, bestScore: r.best, me: r.user_id === viewerId })) };
  }

  /** Finished games of the user, for the personal data export. */
  async exportFor(userId: string): Promise<{ startedAt: string; correct: number; score: number }[]> {
    const res = await this.db.execute<{ started_at: Date; correct_count: number; score: number }>(sql`
      SELECT started_at, correct_count, score FROM game_sessions WHERE user_id = ${userId}::uuid AND finished_at IS NOT NULL ORDER BY started_at, id`);
    return res.rows.map((r) => ({ startedAt: iso(r.started_at), correct: r.correct_count, score: r.score }));
  }

  // ---- Administrators ---------------------------------------------------------------------------

  async createQuestion(body: CreateGameQuestionRequest): Promise<AdminGameQuestion> {
    const res = await this.db.execute<QuestionRow>(sql`
      INSERT INTO game_questions (prompt, options, correct_index, category) VALUES (${body.prompt}, ${JSON.stringify(body.options)}::jsonb, ${body.correctIndex}, ${body.category})
      RETURNING id, prompt, options, correct_index, category, active`);
    return toAdmin(res.rows[0]!);
  }

  async listQuestions(): Promise<AdminGameQuestionList> {
    const res = await this.db.execute<QuestionRow>(sql`SELECT id, prompt, options, correct_index, category, active FROM game_questions ORDER BY created_at DESC, id LIMIT 500`);
    return { items: res.rows.map(toAdmin) };
  }

  async createTournament(adminId: string, body: CreateTournamentRequest, meta: RequestMeta): Promise<Tournament> {
    const res = await this.db.transaction(async (tx) => {
      const ins = await tx.execute<TournamentRow>(sql`
        INSERT INTO game_tournaments (title, starts_at, ends_at) VALUES (${body.title}, ${body.startsAt}::timestamptz, ${body.endsAt}::timestamptz)
        RETURNING ${TOURNAMENT_COLS}`);
      await this.audit.record({ action: 'games.tournament_created', actorUserId: adminId, meta, metadata: { tournamentId: ins.rows[0]!.id } }, tx);
      return ins.rows[0]!;
    });
    return toTournament(res);
  }

  async setActive(id: string, active: boolean): Promise<AdminGameQuestion> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Question not found');
    const res = await this.db.execute<QuestionRow>(sql`UPDATE game_questions SET active = ${active} WHERE id = ${id}::uuid RETURNING id, prompt, options, correct_index, category, active`);
    if (!res.rows[0]) throw AppError.notFound('Question not found');
    return toAdmin(res.rows[0]);
  }
}
