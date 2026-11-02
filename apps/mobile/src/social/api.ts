import {
  commentListSchema,
  commentSchema,
  conversationSchema,
  postListSchema,
  postSchema,
  publicProfileSchema,
  socialStatsSchema,
  socialUserListSchema,
  type PostVisibility,
  type ReactionType,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export const fetchFeed = (cursor?: string) => api.request('/feed', { query: { limit: PAGE, cursor }, schema: postListSchema });
export const fetchUserPosts = (userId: string, cursor?: string) =>
  api.request(`/users/${userId}/posts`, { query: { limit: PAGE, cursor }, schema: postListSchema });
export const fetchPost = (id: string) => api.request(`/posts/${id}`, { schema: postSchema });
export const fetchComments = (postId: string, cursor?: string) =>
  api.request(`/posts/${postId}/comments`, { query: { limit: 30, cursor }, schema: commentListSchema });
export const fetchProfile = (userId: string) => api.request(`/users/${userId}`, { schema: publicProfileSchema });
export const fetchStats = (userId: string) => api.request(`/users/${userId}/social`, { schema: socialStatsSchema });
export const fetchFollowers = (userId: string, cursor?: string) =>
  api.request(`/users/${userId}/followers`, { query: { limit: 30, cursor }, schema: socialUserListSchema });
export const fetchFollowing = (userId: string, cursor?: string) =>
  api.request(`/users/${userId}/following`, { query: { limit: 30, cursor }, schema: socialUserListSchema });

export const setFollow = (userId: string, follow: boolean) =>
  api.request(`/users/${userId}/follow`, { method: follow ? 'PUT' : 'DELETE' });

export const putReaction = (postId: string, type: ReactionType | null) =>
  api.request(`/posts/${postId}/reaction`, { method: 'PUT', body: { type }, schema: postSchema });

export const createPost = (body: { clientId: string; body?: string; mediaIds: string[]; visibility: PostVisibility }) =>
  api.request('/posts', { method: 'POST', body, schema: postSchema });

export const patchPost = (id: string, body: { body?: string | null; visibility?: PostVisibility }) =>
  api.request(`/posts/${id}`, { method: 'PATCH', body, schema: postSchema });

export const deletePost = (id: string) => api.request(`/posts/${id}`, { method: 'DELETE' });

export const createComment = (postId: string, body: string, replyToId?: string) =>
  api.request(`/posts/${postId}/comments`, { method: 'POST', body: { body, replyToId }, schema: commentSchema });

export const deleteComment = (id: string) => api.request(`/comments/${id}`, { method: 'DELETE' });

export const openDirect = (userId: string) =>
  api.request('/conversations', { method: 'POST', body: { kind: 'direct', userId }, schema: conversationSchema });
