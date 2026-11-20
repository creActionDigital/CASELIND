import {
  type CreateMiniAppRequest,
  miniappActivityListSchema,
  miniappListSchema,
  miniappSchema,
  miniappStatsSchema,
  miniappVersionListSchema,
  miniappVersionSchema,
  miniappWithSecretSchema,
} from '@caselind/contracts';
import { api } from '../../auth/auth-context';

export const devKeys = {
  apps: ['miniapps', 'dev', 'apps'] as const,
  app: (id: string) => ['miniapps', 'dev', 'app', id] as const,
  versions: (id: string) => ['miniapps', 'dev', 'versions', id] as const,
  stats: (id: string, days: number) => ['miniapps', 'dev', 'stats', id, days] as const,
  activity: (id: string) => ['miniapps', 'activity', id] as const,
};

export const fetchMyApps = () => api.request('/me/miniapps', { schema: miniappListSchema });
/** Détail d'une application de l'organisation (jamais le secret). */
export const fetchApp = (orgId: string, appId: string) => api.request(`/orgs/${orgId}/miniapps/${appId}`, { schema: miniappSchema });
export const createApp = (orgId: string, body: CreateMiniAppRequest) => api.request(`/orgs/${orgId}/miniapps`, { method: 'POST', body, schema: miniappWithSecretSchema });
export const submitApp = (orgId: string, appId: string) => api.request(`/orgs/${orgId}/miniapps/${appId}/submit`, { method: 'POST', schema: miniappSchema });
/** Le nouveau secret n'est renvoyé qu'ici, une seule fois. */
export const rotateSecret = (orgId: string, appId: string) => api.request(`/orgs/${orgId}/miniapps/${appId}/rotate-secret`, { method: 'POST', schema: miniappWithSecretSchema });

export const fetchVersions = (appId: string) => api.request(`/miniapps/${appId}/versions`, { query: { limit: 50 }, schema: miniappVersionListSchema });
export const createVersion = (appId: string, body: { version: string; changelog?: string | null; scopes?: string[] }) =>
  api.request(`/miniapps/${appId}/versions`, { method: 'POST', body, schema: miniappVersionSchema });
export const submitVersion = (appId: string, versionId: string) => api.request(`/miniapps/${appId}/versions/${versionId}/submit`, { method: 'POST', schema: miniappVersionSchema });

export const fetchStats = (appId: string, days: 7 | 30 | 90) => api.request(`/miniapps/${appId}/stats`, { query: { days }, schema: miniappStatsSchema });

/** Activité d'une application sur les données de l'utilisateur connecté (90 jours). */
export const fetchActivity = (appId: string, cursor?: string) => api.request(`/me/miniapps/${appId}/activity`, { query: { limit: 30, cursor }, schema: miniappActivityListSchema });
