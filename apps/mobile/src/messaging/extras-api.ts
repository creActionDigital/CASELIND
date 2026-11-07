import {
  draftSchema,
  favoriteListSchema,
  forwardMessageResponseSchema,
  scheduledMessageListSchema,
  scheduledMessageSchema,
  type Draft,
  type ForwardMessageResponse,
  type ScheduledMessage,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';
import { ApiRequestError } from '../lib/api';

export const extrasKeys = {
  favorites: ['favorites'] as const,
  scheduled: ['scheduled'] as const,
  draft: (conversationId: string) => ['draft', conversationId] as const,
};

export const forwardMessage = (messageId: string, conversationIds: string[], clientId: string): Promise<ForwardMessageResponse> =>
  api.request(`/messages/${messageId}/forward`, { method: 'POST', body: { conversationIds, clientId }, schema: forwardMessageResponseSchema });

export const setFavorite = (messageId: string, on: boolean) =>
  api.request(`/messages/${messageId}/favorite`, { method: on ? 'PUT' : 'DELETE' });

export const fetchFavorites = (cursor?: string) =>
  api.request('/me/favorites', { query: { limit: 30, cursor }, schema: favoriteListSchema });

export const patchDisappearing = (conversationId: string, seconds: number | null) =>
  api.request(`/conversations/${conversationId}`, { method: 'PATCH', body: { disappearingSeconds: seconds } });

/** Réponse 202 : message programmé (aucune bulle). */
export const scheduleMessage = (
  conversationId: string,
  body: { clientId: string; body: string; scheduledAt: string; replyToId?: string },
): Promise<ScheduledMessage> =>
  api.request(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { ...body, kind: 'text' },
    schema: scheduledMessageSchema,
  });

export const fetchScheduled = () => api.request('/me/scheduled-messages', { schema: scheduledMessageListSchema });
export const cancelScheduled = (id: string) => api.request(`/me/scheduled-messages/${id}`, { method: 'DELETE' });

export const saveDraft = (conversationId: string, body: string) =>
  api.request(`/conversations/${conversationId}/draft`, { method: 'PUT', body: { body }, schema: draftSchema });
export const deleteDraft = (conversationId: string) => api.request(`/conversations/${conversationId}/draft`, { method: 'DELETE' });

/** Brouillon serveur ; 404 = aucun brouillon. */
export async function fetchDraft(conversationId: string): Promise<Draft | null> {
  try {
    return await api.request(`/conversations/${conversationId}/draft`, { schema: draftSchema });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}
