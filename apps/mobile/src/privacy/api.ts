import {
  accountConsentsSchema,
  consentHistorySchema,
  deletionRequestResponseSchema,
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
