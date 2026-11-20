import {
  authorizePreviewSchema,
  authorizeResponseSchema,
  miniappListSchema,
  miniappRevenueSchema,
  miniappSchema,
  miniappVersionListSchema,
  miniappVersionSchema,
  miniappWebhookDeliveryListSchema,
  miniappWebhookDeliverySchema,
  miniappWebhookSchema,
  miniappWebhookWithSecretSchema,
  type AuthorizeRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

/** Appels de la plateforme développeurs, phase 2 : consentement natif, webhook, revenus, certification, revue des versions. */

export const pKeys = {
  preview: (clientId: string, redirectUri: string, scopes: string) => ['miniapps', 'consent', clientId, redirectUri, scopes] as const,
  detail: (id: string) => ['miniapps', 'detail', id] as const,
  webhook: (id: string) => ['miniapps', 'dev', 'webhook', id] as const,
  deliveries: (id: string) => ['miniapps', 'dev', 'deliveries', id] as const,
  revenue: (id: string) => ['miniapps', 'dev', 'revenue', id] as const,
  adminVersions: (status: string) => ['miniapps', 'admin', 'versions', status] as const,
  adminApps: ['miniapps', 'admin', 'apps'] as const,
};

// ---- consentement (l'écran appelle d'abord l'aperçu : le serveur compare redirect_uri à l'identique avant tout retour) ----
export const fetchConsentPreview = (clientId: string, redirectUri: string, scopes: string[]) =>
  api.request('/oauth/authorize/preview', { query: { clientId, redirectUri, scopes: scopes.join(' ') }, schema: authorizePreviewSchema });
export const authorizeApp = (body: Omit<AuthorizeRequest, 'codeChallengeMethod'>) =>
  api.request('/oauth/authorize', { method: 'POST', body: { ...body, codeChallengeMethod: 'S256' }, schema: authorizeResponseSchema });
export const setAppMuted = (appId: string, muted: boolean) => api.request(`/me/miniapp-grants/${appId}/notifications`, { method: 'PUT', body: { muted } });

// ---- webhook de l'application (propriétaire) ----
export const fetchWebhook = (appId: string) => api.request(`/miniapps/${appId}/webhook`, { schema: miniappWebhookSchema });
export const createWebhook = (appId: string, body: { url: string; events?: string[] }) =>
  api.request(`/miniapps/${appId}/webhook`, { method: 'POST', body, schema: miniappWebhookWithSecretSchema });
export const rotateWebhookSecret = (appId: string) => api.request(`/miniapps/${appId}/webhook/rotate-secret`, { method: 'POST', schema: miniappWebhookWithSecretSchema });
export const deleteWebhook = (appId: string) => api.request(`/miniapps/${appId}/webhook`, { method: 'DELETE' });
export const testWebhook = (appId: string) => api.request(`/miniapps/${appId}/webhook/test`, { method: 'POST', schema: miniappWebhookDeliverySchema });
export const fetchDeliveries = (appId: string) => api.request(`/miniapps/${appId}/webhook/deliveries`, { schema: miniappWebhookDeliveryListSchema });

// ---- manifeste (brouillon d'application ou nouvelle version) ----
export const saveDraftManifest = (orgId: string, appId: string, manifest: unknown) =>
  api.request(`/orgs/${orgId}/miniapps/${appId}`, { method: 'PATCH', body: { manifest }, schema: miniappSchema });
export const createVersionWithManifest = (appId: string, body: { version: string; changelog?: string | null; manifest: unknown; scopes?: string[] }) =>
  api.request(`/miniapps/${appId}/versions`, { method: 'POST', body, schema: miniappVersionSchema });

// ---- revenus (relevés indicatifs) ----
export const fetchRevenue = (appId: string) => api.request(`/miniapps/${appId}/revenue`, { schema: miniappRevenueSchema });

// ---- administration ----
export const fetchReviewVersions = (status: string, cursor?: string) =>
  api.request('/admin/miniapps/versions', { query: { status, limit: 20, ...(cursor ? { cursor } : {}) }, schema: miniappVersionListSchema });
export const decideVersion = (versionId: string, decision: 'approve' | 'reject', note?: string) =>
  api.request(`/admin/miniapps/versions/${versionId}/${decision}`, { method: 'POST', body: { note: note || undefined }, schema: miniappVersionSchema });
export const fetchPublishedApps = (cursor?: string) =>
  api.request('/admin/miniapps', { query: { status: 'published', limit: 20, ...(cursor ? { cursor } : {}) }, schema: miniappListSchema });
export const certifyApp = (appId: string, note: string) => api.request(`/admin/miniapps/${appId}/certify`, { method: 'POST', body: { note }, schema: miniappSchema });
export const decertifyApp = (appId: string) => api.request(`/admin/miniapps/${appId}/decertify`, { method: 'POST', schema: miniappSchema });
export const setAppQuota = (appId: string, rateLimitPerMinute: number | null) => api.request(`/admin/miniapps/${appId}/quota`, { method: 'PATCH', body: { rateLimitPerMinute }, schema: miniappSchema });
export const setAppRevenueShare = (appId: string, revenueShareBps: number) => api.request(`/admin/miniapps/${appId}/revenue-share`, { method: 'PATCH', body: { revenueShareBps }, schema: miniappSchema });
export const suspendApp = (appId: string, note: string) => api.request(`/admin/miniapps/${appId}/review`, { method: 'POST', body: { decision: 'suspend', note }, schema: miniappSchema });
