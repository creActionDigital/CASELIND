import { communityListSchema, communitySchema, trendingTagsSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchCommunities = (tag?: string) => api.request('/communities', { query: { tag, limit: 20 }, schema: communityListSchema });
export const fetchTrendingTags = () => api.request('/communities/tags', { schema: trendingTagsSchema });
export const joinCommunity = (id: string) => api.request(`/communities/${id}/join`, { method: 'POST', schema: communitySchema });
export const fetchCommunity = (id: string) => api.request(`/communities/${id}`, { schema: communitySchema });
export const publishCommunity = (id: string) => api.request(`/conversations/${id}/community`, { method: 'PUT', body: { description: '', tags: [] }, schema: communitySchema });
export const unpublishCommunity = (id: string) => api.request(`/conversations/${id}/community`, { method: 'DELETE' });
