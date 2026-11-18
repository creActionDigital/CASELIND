import {
  myOrgQuestionListSchema,
  myOrgQuestionSchema,
  myStoreReviewSchema,
  orgQuestionListSchema,
  publicOrgQuestionListSchema,
  storeReviewListSchema,
  storeReviewSchema,
  type SaveStoreReviewRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const reviewsKeys = {
  publicReviews: (slug: string) => ['org-reviews-public', slug] as const,
  publicQuestions: (slug: string) => ['org-questions-public', slug] as const,
  mine: (orgId: string) => ['org-review-mine', orgId] as const,
  myQuestions: ['org-questions-mine'] as const,
  staffReviews: (orgId: string) => ['org-store-reviews', orgId] as const,
  staffQuestions: (orgId: string) => ['org-questions-staff', orgId] as const,
};

const PAGE = 5;
const enc = encodeURIComponent;

/** Avis : le jeton, s'il existe, sert seulement à écarter les auteurs bloqués. */
export const fetchPublicReviews = (slug: string, cursor?: string) =>
  api.request(`/public/orgs/${enc(slug)}/reviews`, { query: { limit: PAGE, cursor }, schema: storeReviewListSchema });
export const fetchPublicQuestions = (slug: string, cursor?: string) =>
  api.request(`/public/orgs/${enc(slug)}/questions`, { query: { limit: PAGE, cursor }, schema: publicOrgQuestionListSchema, auth: false });

export const fetchMyStoreReview = (orgId: string) => api.request(`/me/org-reviews/${orgId}`, { schema: myStoreReviewSchema });
export const saveMyStoreReview = (orgId: string, body: SaveStoreReviewRequest) => api.request(`/me/org-reviews/${orgId}`, { method: 'PUT', body, schema: storeReviewSchema });
export const deleteMyStoreReview = (orgId: string) => api.request(`/me/org-reviews/${orgId}`, { method: 'DELETE' });

export const askQuestion = (orgId: string, question: string) => api.request('/me/org-questions', { method: 'POST', body: { orgId, question }, schema: myOrgQuestionSchema });
export const fetchMyQuestions = () => api.request('/me/org-questions', { query: { limit: 50 }, schema: myOrgQuestionListSchema });

export const fetchStoreReviews = (orgId: string, status: 'all' | 'unanswered', cursor?: string) =>
  api.request(`/orgs/${orgId}/store-reviews`, { query: { limit: 20, status, cursor }, schema: storeReviewListSchema });
export const replyStoreReview = (orgId: string, id: string, body: string) => api.request(`/orgs/${orgId}/store-reviews/${id}/reply`, { method: 'POST', body: { body }, schema: storeReviewSchema });

export const fetchOrgQuestions = (orgId: string, status: 'pending' | 'answered', cursor?: string) =>
  api.request(`/orgs/${orgId}/questions`, { query: { limit: 20, status, cursor }, schema: orgQuestionListSchema });
export const answerQuestion = (orgId: string, id: string, answer: string) => api.request(`/orgs/${orgId}/questions/${id}/answer`, { method: 'POST', body: { answer } });
export const deleteQuestion = (orgId: string, id: string) => api.request(`/orgs/${orgId}/questions/${id}`, { method: 'DELETE' });
