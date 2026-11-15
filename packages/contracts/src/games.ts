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
