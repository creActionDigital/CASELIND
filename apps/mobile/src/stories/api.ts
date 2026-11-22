import { storyFeedSchema, storyListSchema, storyPageSchema, storySchema, storyViewerListSchema, type StoryVisibility } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchStoryArchive = (cursor?: string) => api.request('/me/stories/archive', { query: { limit: 30, cursor }, schema: storyPageSchema });
export const fetchUserStories = (userId: string) => api.request(`/users/${userId}/stories`, { schema: storyListSchema });
export const fetchStoryFeed = () => api.request('/stories/feed', { schema: storyFeedSchema });

export const markStoryViewed = (id: string) => api.request(`/stories/${id}/view`, { method: 'POST' });

export const fetchStoryViewers = (id: string, cursor?: string) =>
  api.request(`/stories/${id}/viewers`, { query: { cursor, limit: 50 }, schema: storyViewerListSchema });

export const deleteStory = (id: string) => api.request(`/stories/${id}`, { method: 'DELETE' });

export const createStory = (body: { clientId: string; mediaId: string; caption?: string; visibility: StoryVisibility }) =>
  api.request('/stories', { method: 'POST', body, schema: storySchema });
