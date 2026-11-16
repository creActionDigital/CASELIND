import { z } from 'zod';

/**
 * Play & Win, quiz éclair (lot 20a, CDC §21). A game of skill: ten questions, two minutes, a score computed on the server.
 * No money, no CSL Coins, no NFT, no bet. The correct answer is never sent before grading.
 */
export const QUIZ_QUESTIONS_PER_SESSION = 10;

export const createGameQuestionRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(300),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(5),
    correctIndex: z.number().int().min(0),
    category: z.string().trim().max(40).default(''),
  })
  .refine((q) => q.correctIndex < q.options.length, { path: ['correctIndex'], message: 'correctIndex must point to one of the options' });
export type CreateGameQuestionRequest = z.infer<typeof createGameQuestionRequestSchema>;

export const updateGameQuestionRequestSchema = z.object({ active: z.boolean() });
export type UpdateGameQuestionRequest = z.infer<typeof updateGameQuestionRequestSchema>;

/** Administrators see the key; players never do. */
export const adminGameQuestionSchema = z.object({
  id: z.uuid(),
  prompt: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number().int(),
  category: z.string(),
  active: z.boolean(),
});
export type AdminGameQuestion = z.infer<typeof adminGameQuestionSchema>;
export const adminGameQuestionListSchema = z.object({ items: z.array(adminGameQuestionSchema) });
export type AdminGameQuestionList = z.infer<typeof adminGameQuestionListSchema>;

export const quizSessionSchema = z.object({
  id: z.uuid(),
  expiresAt: z.string(),
  questions: z.array(z.object({ id: z.uuid(), prompt: z.string(), options: z.array(z.string()) })),
});
export type QuizSession = z.infer<typeof quizSessionSchema>;

/** One answer per question, in the order they were given. */
export const submitQuizAnswersRequestSchema = z.object({ answers: z.array(z.number().int().min(0)).length(QUIZ_QUESTIONS_PER_SESSION) });
export type SubmitQuizAnswersRequest = z.infer<typeof submitQuizAnswersRequestSchema>;
export const gameQuizResultSchema = z.object({ correct: z.number().int(), total: z.number().int(), score: z.number().int() });
export type GameQuizResult = z.infer<typeof gameQuizResultSchema>;

export const leaderboardQuerySchema = z.object({ period: z.enum(['week', 'all']).default('week') });
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export const leaderboardSchema = z.object({
  period: z.enum(['week', 'all']),
  items: z.array(z.object({ rank: z.number().int(), displayName: z.string(), handle: z.string(), bestScore: z.number().int(), me: z.boolean() })),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

/** Badges (lot 20b): earned by playing, never bought, no value. Derived from the finished games, nothing is stored. */
export const gameBadgeSchema = z.object({ key: z.enum(['first_game', 'ten_games', 'perfect']), earned: z.boolean(), progress: z.number().int(), target: z.number().int() });
export type GameBadge = z.infer<typeof gameBadgeSchema>;
export const gameBadgeListSchema = z.object({ items: z.array(gameBadgeSchema) });
export type GameBadgeList = z.infer<typeof gameBadgeListSchema>;

/** Tournaments (lot 20b): a time window opened by an administrator; the ranking is the best score finished inside it. No prize, no entry fee. */
export const createTournamentRequestSchema = z
  .object({ title: z.string().trim().min(1).max(80), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })
  .refine((t) => Date.parse(t.endsAt) > Date.parse(t.startsAt), { path: ['endsAt'], message: 'endsAt must be after startsAt' });
export type CreateTournamentRequest = z.infer<typeof createTournamentRequestSchema>;
export const tournamentSchema = z.object({ id: z.uuid(), title: z.string(), startsAt: z.string(), endsAt: z.string(), status: z.enum(['upcoming', 'live', 'ended']) });
export type Tournament = z.infer<typeof tournamentSchema>;
export const tournamentListSchema = z.object({ items: z.array(tournamentSchema) });
export type TournamentList = z.infer<typeof tournamentListSchema>;
export const tournamentRankingSchema = z.object({ tournament: tournamentSchema, items: leaderboardSchema.shape.items });
export type TournamentRanking = z.infer<typeof tournamentRankingSchema>;
