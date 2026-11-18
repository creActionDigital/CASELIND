import { messageSchema, messageSearchResultSchema, presenceSchema, type Message, type MessageSearchResult, type Presence } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../auth/auth-context';

export const createPoll = (
  conversationId: string,
  body: { clientId: string; question: string; options: string[]; multiple: boolean },
): Promise<Message> => api.request(`/conversations/${conversationId}/polls`, { method: 'POST', body, schema: messageSchema });

export const votePoll = (messageId: string, optionIds: string[]): Promise<Message> =>
  api.request(`/messages/${messageId}/poll/vote`, { method: 'PUT', body: { optionIds }, schema: messageSchema });

export const closePoll = (messageId: string): Promise<Message> =>
  api.request(`/messages/${messageId}/poll/close`, { method: 'POST', schema: messageSchema });

export const searchMessages = (q: string, cursor?: string): Promise<MessageSearchResult> =>
  api.request('/messages/search', { query: { q: q.trim(), limit: 20, cursor }, schema: messageSearchResultSchema });

export const fetchPresence = (userId: string): Promise<Presence> => api.request(`/presence/${userId}`, { schema: presenceSchema });

export const presenceKey = (userId: string) => ['presence', userId] as const;

/** Présence d'un pair direct ; tenue à jour par l'événement `presence.updated` (voir realtime-context). */
export function usePresence(userId: string | undefined) {
  return useQuery({
    queryKey: presenceKey(userId ?? ''),
    queryFn: () => fetchPresence(userId!),
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });
}
