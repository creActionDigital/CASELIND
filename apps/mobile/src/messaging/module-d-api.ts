import {
  type CreateHelpRequestRequest as CreateHelpRequest,
  helpRequestListSchema,
  helpRequestSchema,
  miniappFavoriteListSchema,
  pinnedMessageListSchema,
  type ResolveHelpRequestRequest as ResolveHelpRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const mdKeys = {
  pins: (conversationId: string) => ['md', 'pins', conversationId] as const,
  help: ['md', 'help'] as const,
  adminHelp: ['md', 'admin-help'] as const,
  favorites: ['md', 'miniapp-favorites'] as const,
  recents: ['md', 'miniapp-recents'] as const,
};

export const fetchPins = (conversationId: string) => api.request(`/conversations/${conversationId}/pins`, { schema: pinnedMessageListSchema });
export const setPin = (messageId: string, pinned: boolean) => api.request(`/messages/${messageId}/pin`, { method: pinned ? 'PUT' : 'DELETE' });

export const fetchMyHelp = () => api.request('/me/help-requests', { schema: helpRequestListSchema });
export const createHelp = (body: CreateHelpRequest) => api.request('/me/help-requests', { method: 'POST', body, schema: helpRequestSchema });
export const fetchAdminHelp = () => api.request('/admin/help-requests', { schema: helpRequestListSchema });
export const resolveHelp = (id: string, body: ResolveHelpRequest) => api.request(`/admin/help-requests/${id}/resolve`, { method: 'POST', body, schema: helpRequestSchema });

export const fetchFavoriteApps = () => api.request('/me/miniapp-favorites', { schema: miniappFavoriteListSchema });
export const setFavoriteApp = (appId: string, on: boolean) => api.request(`/me/miniapp-favorites/${appId}`, { method: on ? 'PUT' : 'DELETE' });
