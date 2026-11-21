import { orgMemberListSchema, orgMemberSchema, type OrgRole } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const teamKeys = { members: (orgId: string) => ['org-members', orgId] as const };

export const fetchMembers = (orgId: string, cursor?: string) =>
  api.request(`/orgs/${orgId}/members`, { query: { cursor, limit: 50 }, schema: orgMemberListSchema });
export const inviteMember = (orgId: string, handle: string, role: OrgRole) =>
  api.request(`/orgs/${orgId}/invitations`, { method: 'POST', body: { handle: handle.replace(/^@/, '').trim().toLowerCase(), role }, schema: orgMemberSchema });
export const changeMemberRole = (orgId: string, userId: string, role: OrgRole) =>
  api.request(`/orgs/${orgId}/members/${userId}`, { method: 'PATCH', body: { role }, schema: orgMemberSchema });
export const removeMember = (orgId: string, userId: string) => api.request(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
