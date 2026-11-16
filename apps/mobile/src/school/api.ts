import {
  announcementSchema,
  classMemberListSchema,
  myClassDetailSchema,
  myClassListSchema,
  schoolClassListSchema,
  schoolClassSchema,
  schoolLessonSchema,
  type CreateAnnouncementRequest,
  type CreateLessonRequest,
  type SchoolRole,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const schk = {
  mine: ['school', 'mine'] as const,
  one: (id: string) => ['school', 'one', id] as const,
  classes: (orgId: string) => ['school', orgId, 'classes'] as const,
  members: (orgId: string, id: string) => ['school', orgId, 'members', id] as const,
};

export const fetchMyClasses = () => api.request('/me/school/classes', { schema: myClassListSchema });
export const fetchMyClass = (id: string) => api.request(`/me/school/classes/${id}`, { schema: myClassDetailSchema });

const base = (orgId: string) => `/orgs/${orgId}/school/classes`;
export const fetchOrgClasses = (orgId: string) => api.request(base(orgId), { schema: schoolClassListSchema });
export const createClass = (orgId: string, body: { name: string; yearLabel: string }) => api.request(base(orgId), { method: 'POST', body, schema: schoolClassSchema });
export const fetchMembers = (orgId: string, id: string) => api.request(`${base(orgId)}/${id}/members`, { schema: classMemberListSchema });
export const enroll = (orgId: string, id: string, body: { handle: string; role: SchoolRole }) => api.request(`${base(orgId)}/${id}/members`, { method: 'POST', body });
export const unenroll = (orgId: string, id: string, handle: string) => api.request(`${base(orgId)}/${id}/members/${encodeURIComponent(handle)}`, { method: 'DELETE' });
export const addLesson = (orgId: string, id: string, body: CreateLessonRequest) => api.request(`${base(orgId)}/${id}/lessons`, { method: 'POST', body, schema: schoolLessonSchema });
export const announce = (orgId: string, id: string, body: CreateAnnouncementRequest) => api.request(`${base(orgId)}/${id}/announcements`, { method: 'POST', body, schema: announcementSchema });
