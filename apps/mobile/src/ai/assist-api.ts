import {
  aiActionListSchema,
  aiActionOutcomeSchema,
  aiActionSchema,
  naturalSearchResultSchema,
  translationResultSchema,
  type NaturalFilters,
  type TranslationLocale,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

/** Traduction des messages, actions de l'assistant et recherche en langage naturel. */
export const assistKeys = {
  actions: (conversationId: string) => ['ai', 'actions', conversationId] as const,
  natural: (q: string) => ['search', 'natural', q] as const,
};

export const translateMessage = (messageId: string, target: TranslationLocale) =>
  api.request(`/messages/${messageId}/translate`, { method: 'POST', body: { target, informed: true }, schema: translationResultSchema });

export const fetchAiActions = (conversationId: string) => api.request(`/ai/conversations/${conversationId}/actions`, { schema: aiActionListSchema });
export const confirmAiAction = (id: string) => api.request(`/ai/actions/${id}/confirm`, { method: 'POST', schema: aiActionOutcomeSchema });
export const dismissAiAction = (id: string) => api.request(`/ai/actions/${id}/dismiss`, { method: 'POST', schema: aiActionSchema });

export const fetchNaturalSearch = (q: string) => api.request('/search/natural', { query: { q }, schema: naturalSearchResultSchema });
export const fetchNaturalWith = (filters: NaturalFilters) =>
  api.request('/search/natural/filters', { method: 'POST', body: { filters }, schema: naturalSearchResultSchema });
