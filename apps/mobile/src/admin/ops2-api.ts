import {
  adminAnnouncementListSchema,
  adminAnnouncementSchema,
  adminAppealListSchema,
  adminAppealSchema,
  adminBoostListSchema,
  adminBoostSchema,
  adminCommissionStatementSchema,
  adminSettingListSchema,
  adminWalletAlertListSchema,
  adminWalletAlertSchema,
  approvalPendingSchema,
  orgCommissionStatementSchema,
  platformAnnouncementListSchema,
  sanctionListSchema,
  sanctionSchema,
  type IssueSanctionRequest,
} from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';

/** Appels des écrans d'administration de la suite du §26. Les clés de requête partagent la racine `admin-ops2` pour s'invalider d'un bloc. */
export const o2k = {
  all: ['admin-ops2'] as const,
  list: (name: string, ...rest: (string | number | undefined)[]) => ['admin-ops2', name, ...rest] as const,
};

type Q = Record<string, string | number | undefined>;
const page = (cursor?: string): Q => (cursor ? { cursor } : {});

// Sanctions et recours
export const fetchSanctions = (status: string, userId: string, cursor?: string) =>
  api.request('/admin/sanctions', { query: { status: status || undefined, userId: userId || undefined, limit: 20, ...page(cursor) }, schema: sanctionListSchema });
/** 201 `Sanction`, ou 202 `{ approvalId, status: 'pending' }` quand la double validation est active. */
export const issueSanction = (userId: string, body: IssueSanctionRequest) =>
  api.request(`/admin/users/${userId}/sanctions`, { method: 'POST', body, schema: z.union([sanctionSchema, approvalPendingSchema]) });
export const liftSanction = (id: string, note?: string) => api.request(`/admin/sanctions/${id}/lift`, { method: 'POST', body: { note: note || undefined }, schema: sanctionSchema });
export const fetchAppeals = (status: string, cursor?: string) => api.request('/admin/appeals', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminAppealListSchema });
export const decideAppeal = (id: string, decision: 'accepted' | 'rejected', note?: string) =>
  api.request(`/admin/appeals/${id}/decide`, { method: 'POST', body: { decision, note: note || undefined }, schema: adminAppealSchema });
export const fetchMySanctions = (cursor?: string) => api.request('/me/sanctions', { query: { limit: 20, ...page(cursor) }, schema: sanctionListSchema });
export const appealSanction = (id: string, message: string) => api.request(`/me/sanctions/${id}/appeal`, { method: 'POST', body: { message }, schema: sanctionSchema });

// Annonces
export const fetchAdminAnnouncements = (status: string, cursor?: string) =>
  api.request('/admin/announcements', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminAnnouncementListSchema });
export const createAnnouncement = (b: { title: string; body: string; audience: string; endsAt: string }) => api.request('/admin/announcements', { method: 'POST', body: b, schema: adminAnnouncementSchema });
export const announcementAction = (id: string, what: 'publish' | 'end') => api.request(`/admin/announcements/${id}/${what}`, { method: 'POST', schema: adminAnnouncementSchema });
export const deleteAnnouncement = (id: string) => api.request(`/admin/announcements/${id}`, { method: 'DELETE' });
export const fetchAnnouncements = (cursor?: string) => api.request('/announcements', { query: { limit: 20, ...page(cursor) }, schema: platformAnnouncementListSchema });

// Paramètres
export const fetchSettings = () => api.request('/admin/settings', { schema: adminSettingListSchema });
/** 200 le réglage, ou 202 `{ approvalId, status: 'pending' }` pour `commission.defaultBps` et `limits.*` avec la double validation. */
export const putSetting = (b: { key: string; scope: string; value: unknown; reason: string }) =>
  api.request('/admin/settings', { method: 'PUT', body: b, schema: z.union([approvalPendingSchema, z.object({ key: z.string() }).passthrough()]) });

// Commissions
export const fetchPlatformCommissions = (from: string, to: string) => api.request('/admin/commissions', { query: { from: from || undefined, to: to || undefined }, schema: adminCommissionStatementSchema });
export const fetchOrgCommissions = (orgId: string, cursor?: string) => api.request(`/orgs/${orgId}/commissions`, { query: { limit: 20, ...page(cursor) }, schema: orgCommissionStatementSchema });
export const setOrgCommission = (orgId: string, bps: number | null, reason: string) => api.request(`/admin/orgs/${orgId}/commission`, { method: 'PUT', body: { bps, reason } });

// Alertes du portefeuille et boosts
export const fetchWalletAlerts = (status: string, cursor?: string) => api.request('/admin/wallet-alerts', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminWalletAlertListSchema });
export const reviewWalletAlert = (id: string) => api.request(`/admin/wallet-alerts/${id}/review`, { method: 'POST', schema: adminWalletAlertSchema });
export const fetchBoosts = (status: string, cursor?: string) => api.request('/admin/boosts', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminBoostListSchema });
export const rejectBoost = (id: string) => api.request(`/admin/boosts/${id}/reject`, { method: 'POST', schema: adminBoostSchema });

// Donner un rôle plateforme : 204, ou 202 `{ approvalId, status }`
export const grantRole = (userId: string, role: 'moderator' | 'support' | 'admin', reason: string) =>
  api.request(`/admin/users/${userId}/platform-roles`, { method: 'POST', body: { role, reason }, schema: z.object({ approvalId: z.string().optional() }).passthrough() });
