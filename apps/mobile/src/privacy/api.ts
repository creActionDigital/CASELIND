import {
  accountConsentsSchema,
  blockListSchema,
  consentHistorySchema,
  deletionRequestResponseSchema,
  securityEventSchema,
  userConsentSchema,
  type ConsentKind,
} from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';

export const privacyKeys = { consents: ['consents'] as const, history: ['consents-history'] as const };

export const fetchConsents = () => api.request('/me/consents', { schema: accountConsentsSchema });
export const fetchConsentHistory = () => api.request('/me/consents/history', { schema: consentHistorySchema });
export const setConsent = (kind: ConsentKind, granted: boolean) =>
  api.request(`/me/consents/${kind}`, { method: 'PUT', body: { granted }, schema: userConsentSchema });

/** Le fichier complet n'est pas validé champ par champ : on ne lit que les listes pour le résumé, le JSON est donné tel quel. */
export const fetchExport = () => api.request('/me/export', { schema: z.record(z.string(), z.unknown()) });
export const requestDeletion = (password: string) =>
  api.request('/me/deletion-request', { method: 'POST', body: { password }, schema: deletionRequestResponseSchema });

export const blockKeys = { list: ['blocks'] as const, events: ['security-events'] as const };
export const fetchBlocks = () => api.request('/blocks', { query: { limit: 200 }, schema: blockListSchema });
export const setBlocked = (userId: string, blocked: boolean) => api.request(`/blocks/${userId}`, { method: blocked ? 'PUT' : 'DELETE' });
export const fetchSecurityEvents = () => api.request('/me/security-events', { schema: z.object({ items: z.array(securityEventSchema) }) });
