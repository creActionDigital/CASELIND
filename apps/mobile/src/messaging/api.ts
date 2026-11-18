import {
  conversationListSchema,
  conversationMemberListSchema,
  conversationSchema,
  messageListSchema,
  messageSchema,
  publicProfileSchema,
  receiptStateSchema,
  type Conversation,
  type Message,
  type PublicProfile,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';
import type { MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { systemText } from './system-text';

export { systemText };

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export const fetchConversations = (archived: boolean, cursor?: string) =>
  api.request('/conversations', {
    query: { archived, limit: 30, cursor },
    schema: conversationListSchema,
  });

export const fetchConversation = (id: string) => api.request(`/conversations/${id}`, { schema: conversationSchema });

export const fetchMessages = (id: string, beforeSeq?: number) =>
  api.request(`/conversations/${id}/messages`, { query: { beforeSeq, limit: 50 }, schema: messageListSchema });

export const fetchMembers = (id: string) =>
  api.request(`/conversations/${id}/members`, { schema: conversationMemberListSchema });

export const postMessage = (
  conversationId: string,
  body: { clientId: string; kind: 'text' | 'media'; body?: string; mediaId?: string; replyToId?: string },
): Promise<Message> =>
  api.request(`/conversations/${conversationId}/messages`, { method: 'POST', body, schema: messageSchema });

export const postReceipt = (conversationId: string, kind: 'delivered' | 'read', seq: number) =>
  api.request(`/conversations/${conversationId}/${kind}`, { method: 'POST', body: { seq }, schema: receiptStateSchema });

export const patchMyState = (id: string, body: { mutedUntil?: string | null; pinned?: boolean; archived?: boolean }) =>
  api.request(`/conversations/${id}/me`, { method: 'PATCH', body });

export const lookupHandle = (handle: string): Promise<PublicProfile> =>
  api.request(`/users/${encodeURIComponent(handle.trim().replace(/^@/, ''))}`, { schema: publicProfileSchema });

export const createDirect = (userId: string): Promise<Conversation> =>
  api.request('/conversations', { method: 'POST', body: { kind: 'direct', userId }, schema: conversationSchema });

export const createGroup = (title: string, memberIds: string[]): Promise<Conversation> =>
  api.request('/conversations', { method: 'POST', body: { kind: 'group', title, memberIds }, schema: conversationSchema });

/** Titre affiché : titre du groupe, ou nom du pair pour un direct. */
export function conversationTitle(c: Pick<Conversation, 'kind' | 'title' | 'peer'>, t: T): string {
  if (c.kind === 'direct') return c.peer?.displayName ?? t('chat.unknownUser');
  return c.title ?? t('chat.group');
}

/** Aperçu d'un message pour la liste (jamais de contenu pour un message rappelé). */
export function messagePreview(m: Message, t: T, name: (userId: string | null) => string = () => '…'): string {
  if (m.recalled) return t('chat.recalled');
  if (m.kind === 'system' && m.systemEvent) return systemText(m.systemEvent, name, t);
  if (m.kind === 'media') return t('chat.photo');
  if (m.kind === 'poll') return t('social.poll.preview', { question: m.body ?? '' });
  return m.body ?? '';
}

export function formatListTime(iso: string, locale: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

/** Raison d'un refus de création de conversation, pour un message clair. */
export function startChatErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.status === 403) {
    return err.detail<string>('reason') === 'contact_requests_restricted' ? 'chat.err.contact_restricted' : 'chat.err.blocked';
  }
  if (err.status === 404) return 'chat.err.user_not_found';
  if (err.code === 'last_owner' || err.detail<string>('reason') === 'last_owner') return 'error.last_owner';
  if (err.code === 'group_full' || err.detail<string>('reason') === 'group_full') return 'chat.err.group_full';
  return null;
}
