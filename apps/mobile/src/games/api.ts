import { gameBadgeListSchema, gameQuizResultSchema, leaderboardSchema, quizSessionSchema, tournamentListSchema, tournamentRankingSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const gameKeys = { leaderboard: (period: string) => ['games', 'leaderboard', period] as const, badges: ['games', 'badges'] as const, tournaments: ['games', 'tournaments'] as const, tournament: (id: string) => ['games', 'tournament', id] as const };

export const startQuiz = () => api.request('/games/quiz/sessions', { method: 'POST', schema: quizSessionSchema });
export const submitQuiz = (id: string, answers: number[]) => api.request(`/games/quiz/sessions/${id}/answers`, { method: 'POST', body: { answers }, schema: gameQuizResultSchema });
export const fetchLeaderboard = (period: 'week' | 'all') => api.request('/games/quiz/leaderboard', { query: { period }, schema: leaderboardSchema });
export const fetchBadges = () => api.request('/games/quiz/badges', { schema: gameBadgeListSchema });
export const fetchTournaments = () => api.request('/games/quiz/tournaments', { schema: tournamentListSchema });
export const fetchTournament = (id: string) => api.request(`/games/quiz/tournaments/${id}`, { schema: tournamentRankingSchema });
