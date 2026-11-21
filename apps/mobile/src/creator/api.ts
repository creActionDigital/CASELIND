import {
  boostResponseSchema,
  creatorOverviewSchema,
  hashtagListSchema,
  popularCreatorListSchema,
  postListSchema,
  recordImpressionsResponseSchema,
  tipResponseSchema,
  type CreatorOverviewQuery,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export const putBookmark = (postId: string, on: boolean) =>
  api.request(`/me/bookmarks/posts/${postId}`, { method: on ? 'PUT' : 'DELETE' });
export const fetchBookmarks = (cursor?: string) => api.request('/me/bookmarks/posts', { query: { limit: PAGE, cursor }, schema: postListSchema });

export const fetchTrending = () => api.request('/hashtags/trending', { query: { hours: 24 }, schema: hashtagListSchema });
export const fetchPopularCreators = () => api.request('/creators/popular', { schema: popularCreatorListSchema });
export const fetchTagPosts = (tag: string, cursor?: string) =>
  api.request(`/hashtags/${encodeURIComponent(tag)}/posts`, { query: { limit: PAGE, cursor }, schema: postListSchema });

export const sendImpressions = (postIds: string[]) =>
  api.request('/posts/impressions', { method: 'POST', body: { postIds }, schema: recordImpressionsResponseSchema });

export const fetchOverview = (days: CreatorOverviewQuery['days']) => api.request('/me/creator/overview', { query: { days }, schema: creatorOverviewSchema });

interface PaidBody {
  clientId: string;
  amountMinor: number;
  currency: string;
  pin: string;
}
export const tipPost = (postId: string, body: PaidBody) => api.request(`/posts/${postId}/tips`, { method: 'POST', body, schema: tipResponseSchema });
export const tipUser = (userId: string, body: PaidBody) => api.request(`/users/${userId}/tips`, { method: 'POST', body, schema: tipResponseSchema });
export const boostPost = (postId: string, body: { clientId: string; days: number; budgetMinor: number; currency: string; pin: string }) =>
  api.request(`/posts/${postId}/boost`, { method: 'POST', body, schema: boostResponseSchema });
