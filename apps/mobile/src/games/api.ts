import { gameQuizResultSchema, leaderboardSchema, quizSessionSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const gameKeys = { leaderboard: (period: string) => ['games', 'leaderboard', period] as const };

export const startQuiz = () => api.request('/games/quiz/sessions', { method: 'POST', schema: quizSessionSchema });
export const submitQuiz = (id: string, answers: number[]) => api.request(`/games/quiz/sessions/${id}/answers`, { method: 'POST', body: { answers }, schema: gameQuizResultSchema });
export const fetchLeaderboard = (period: 'week' | 'all') => api.request('/games/quiz/leaderboard', { query: { period }, schema: leaderboardSchema });
