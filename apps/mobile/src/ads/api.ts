import {
  adBillingSchema,
  adCampaignListSchema,
  adCampaignResponseSchema,
  adCampaignSchema,
  adCampaignStatsSchema,
  adminCampaignListSchema,
  servedAdListSchema,
  type AdCampaignActionRequest,
  type AdPlacement,
  type AdStatus,
  type CreateAdCampaignRequest,
} from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';

export const fetchCampaigns = (status: AdStatus | undefined, cursor?: string) =>
  api.request('/ads/campaigns', { query: { status, cursor, limit: 20 }, schema: adCampaignListSchema });
export const createCampaign = (body: CreateAdCampaignRequest) => api.request('/ads/campaigns', { method: 'POST', body, schema: adCampaignResponseSchema });
export const fetchCampaignStats = (id: string) => api.request(`/ads/campaigns/${id}/stats`, { schema: adCampaignStatsSchema });
export const campaignAction = (id: string, action: AdCampaignActionRequest['action']) =>
  api.request(`/ads/campaigns/${id}/action`, { method: 'POST', body: { action }, schema: adCampaignSchema });
export const fetchBilling = () => api.request('/ads/billing', { schema: adBillingSchema });
export const fetchServed = (placement: AdPlacement, limit = 2) => api.request('/ads/serve', { query: { placement, limit }, schema: servedAdListSchema });
const counted = z.object({ counted: z.boolean() });
export const clickAd = (id: string) => api.request(`/ads/${id}/click`, { method: 'POST', schema: counted });
export const clickAdPost = (postId: string) => api.request(`/ads/posts/${postId}/click`, { method: 'POST', schema: counted });

export const fetchAdminAds = (status: AdStatus | undefined, cursor?: string) =>
  api.request('/admin/ads', { query: { status, cursor, limit: 20 }, schema: adminCampaignListSchema });
export const reviewAd = (id: string, body: { decision: 'approve' | 'reject'; reason?: string }) =>
  api.request(`/admin/ads/${id}/review`, { method: 'POST', body, schema: adCampaignSchema });
