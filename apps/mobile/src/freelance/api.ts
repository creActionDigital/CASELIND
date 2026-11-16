import {
  contractListSchema,
  contractSchema,
  freelancerListSchema,
  myFreelanceProfileSchema,
  type MissionCategory,
  type SaveFreelanceProfileRequest,
  missionListSchema,
  missionSchema,
  proposalListSchema,
  proposalSchema,
  type CreateMissionRequest,
  type CreateProposalRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export const frKeys = {
  all: ['freelance'] as const,
  list: (q: string, category: string) => ['freelance', 'list', q, category] as const,
  freelancers: (q: string, category: string) => ['freelance', 'freelancers', q, category] as const,
  profile: ['freelance', 'profile'] as const,
  mission: (id: string) => ['freelance', 'mission', id] as const,
  proposals: (id: string) => ['freelance', 'proposals', id] as const,
  myMissions: ['freelance', 'my-missions'] as const,
  myProposals: ['freelance', 'my-proposals'] as const,
  contracts: ['freelance', 'contracts'] as const,
  contract: (id: string) => ['freelance', 'contract', id] as const,
};

export const fetchMissions = (q: string, category: MissionCategory | null, cursor?: string) =>
  api.request('/missions', { query: { q: q || undefined, category: category ?? undefined, limit: PAGE, cursor }, schema: missionListSchema });
export const fetchFreelancers = (q: string, category: MissionCategory | null, cursor?: string) =>
  api.request('/freelancers', { query: { q: q || undefined, category: category ?? undefined, limit: PAGE, cursor }, schema: freelancerListSchema });
export const fetchMyProfile = () => api.request('/me/freelance-profile', { schema: myFreelanceProfileSchema });
export const saveMyProfile = (body: SaveFreelanceProfileRequest) => api.request('/me/freelance-profile', { method: 'PUT', body, schema: myFreelanceProfileSchema });
export const fetchMission = (id: string) => api.request(`/missions/${id}`, { schema: missionSchema });
export const createMission = (body: CreateMissionRequest) => api.request('/missions', { method: 'POST', body, schema: missionSchema });
export const closeMission = (id: string) => api.request(`/missions/${id}/close`, { method: 'POST', schema: missionSchema });
export const fetchMyMissions = (cursor?: string) => api.request('/me/missions', { query: { limit: PAGE, cursor }, schema: missionListSchema });

export const proposeOnMission = (id: string, body: CreateProposalRequest) => api.request(`/missions/${id}/proposals`, { method: 'POST', body, schema: proposalSchema });
export const fetchMissionProposals = (id: string, cursor?: string) => api.request(`/missions/${id}/proposals`, { query: { limit: PAGE, cursor }, schema: proposalListSchema });
export const fetchMyProposals = (cursor?: string) => api.request('/me/proposals', { query: { limit: PAGE, cursor }, schema: proposalListSchema });
export const withdrawProposal = (id: string) => api.request(`/proposals/${id}/withdraw`, { method: 'POST', schema: proposalSchema });
export const acceptProposal = (id: string) => api.request(`/proposals/${id}/accept`, { method: 'POST', body: {}, schema: contractSchema });

export const fetchContracts = (cursor?: string) => api.request('/me/freelance-contracts', { query: { limit: PAGE, cursor }, schema: contractListSchema });
export const fetchContract = (id: string) => api.request(`/freelance-contracts/${id}`, { schema: contractSchema });
const step = (id: string, mid: string, action: string, body: Record<string, unknown> = {}) =>
  api.request(`/freelance-contracts/${id}/milestones/${mid}/${action}`, { method: 'POST', body, schema: contractSchema });
export const deliverMilestone = (id: string, mid: string, note: string) => step(id, mid, 'deliver', { note });
export const approveMilestone = (id: string, mid: string) => step(id, mid, 'approve');
export const reviseMilestone = (id: string, mid: string, note: string) => step(id, mid, 'revision', { note });
export const cancelContract = (id: string) => api.request(`/freelance-contracts/${id}/cancel`, { method: 'POST', schema: contractSchema });
export const reviewContract = (id: string, rating: number, body: string) => api.request(`/freelance-contracts/${id}/review`, { method: 'POST', body: { rating, body }, schema: contractSchema });
export const openDispute = (id: string, reason: string) => api.request(`/freelance-contracts/${id}/dispute`, { method: 'POST', body: { reason }, schema: contractSchema });
