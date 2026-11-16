import { campaignListSchema, campaignSchema, loyaltyProgramSchema, marketingConsentSchema, myLoyaltySchema, type UpdateLoyaltyProgramRequest } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchMyLoyalty = () => api.request('/me/loyalty', { schema: myLoyaltySchema });
export const setMarketingConsent = (optIn: boolean) => api.request('/me/marketing-consent', { method: 'PUT', body: { optIn }, schema: marketingConsentSchema });
export const fetchProgram = (orgId: string) => api.request(`/orgs/${orgId}/loyalty`, { schema: loyaltyProgramSchema });
export const saveProgram = (orgId: string, body: UpdateLoyaltyProgramRequest) => api.request(`/orgs/${orgId}/loyalty`, { method: 'PUT', body, schema: loyaltyProgramSchema });
export const fetchCampaigns = (orgId: string) => api.request(`/orgs/${orgId}/campaigns`, { schema: campaignListSchema });
export const sendCampaign = (orgId: string, body: { title: string; body: string }) => api.request(`/orgs/${orgId}/campaigns`, { method: 'POST', body, schema: campaignSchema });
