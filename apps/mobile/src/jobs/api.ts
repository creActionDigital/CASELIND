import {
  applicationListSchema,
  applicationSchema,
  interviewListSchema,
  interviewSchema,
  jobAlertListSchema,
  jobAlertSchema,
  jobListSchema,
  jobProfileSchema,
  jobSchema,
  myJobProfileSchema,
  orgApplicationListSchema,
  orgApplicationSchema,
  type ApplicationStatus,
  type ContractType,
  type CreateJobAlertRequest,
  type CreateJobRequest,
  type UpdateJobRequest,
  type JobProfileInput,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export interface JobFilters {
  contractType?: ContractType;
  q?: string;
}

export const jobKeys = {
  all: ['jobs'] as const,
  list: (f: JobFilters) => ['jobs', 'list', f] as const,
  one: (id: string) => ['jobs', 'one', id] as const,
  profile: ['jobs', 'profile'] as const,
  mine: ['jobs', 'mine'] as const,
  alerts: ['jobs', 'alerts'] as const,
  interviews: ['jobs', 'interviews'] as const,
  orgInterviews: (orgId: string, appId: string) => ['jobs', 'org', orgId, 'interviews', appId] as const,
  org: (orgId: string) => ['jobs', 'org', orgId] as const,
  orgApps: (orgId: string, jobId: string) => ['jobs', 'org', orgId, 'apps', jobId] as const,
};

export const fetchJobs = (f: JobFilters, cursor?: string) =>
  api.request('/jobs', { query: { contractType: f.contractType, q: f.q || undefined, limit: PAGE, cursor }, schema: jobListSchema });
export const fetchJob = (id: string) => api.request(`/jobs/${id}`, { schema: jobSchema });
export const applyToJob = (id: string, message: string) => api.request(`/jobs/${id}/applications`, { method: 'POST', body: { message }, schema: applicationSchema });
export const fetchMyApplications = (cursor?: string) => api.request('/me/job-applications', { query: { limit: PAGE, cursor }, schema: applicationListSchema });
export const withdrawApplication = (id: string) => api.request(`/me/job-applications/${id}/withdraw`, { method: 'POST', schema: applicationSchema });
export const fetchMyJobProfile = () => api.request('/me/job-profile', { schema: myJobProfileSchema });
export const saveJobProfile = (body: JobProfileInput) => api.request('/me/job-profile', { method: 'PUT', body, schema: jobProfileSchema });
export const deleteJobProfile = () => api.request('/me/job-profile', { method: 'DELETE' });

export const fetchJobAlerts = () => api.request('/me/job-alerts', { schema: jobAlertListSchema });
export const createJobAlert = (body: CreateJobAlertRequest) => api.request('/me/job-alerts', { method: 'POST', body, schema: jobAlertSchema });
export const deleteJobAlert = (id: string) => api.request(`/me/job-alerts/${id}`, { method: 'DELETE' });

export const fetchOrgJobs = (orgId: string, cursor?: string) => api.request(`/orgs/${orgId}/jobs`, { query: { limit: PAGE, cursor }, schema: jobListSchema });
export const updateOrgJob = (orgId: string, jobId: string, body: UpdateJobRequest) => api.request(`/orgs/${orgId}/jobs/${jobId}`, { method: 'PATCH', body, schema: jobSchema });
export const createOrgJob = (orgId: string, body: CreateJobRequest) => api.request(`/orgs/${orgId}/jobs`, { method: 'POST', body, schema: jobSchema });
export const closeOrgJob = (orgId: string, jobId: string) => api.request(`/orgs/${orgId}/jobs/${jobId}/close`, { method: 'POST', schema: jobSchema });
export const fetchOrgApplications = (orgId: string, jobId: string, cursor?: string) =>
  api.request(`/orgs/${orgId}/jobs/${jobId}/applications`, { query: { limit: PAGE, cursor }, schema: orgApplicationListSchema });
export const setApplicationStatus = (orgId: string, applicationId: string, status: Exclude<ApplicationStatus, 'submitted' | 'withdrawn'>) =>
  api.request(`/orgs/${orgId}/job-applications/${applicationId}/status`, { method: 'POST', body: { status }, schema: orgApplicationSchema });

export const fetchMyInterviews = () => api.request('/me/job-interviews', { schema: interviewListSchema });
export const answerInterview = (id: string, action: 'confirm' | 'decline' | 'cancel', reason = '') =>
  api.request(`/me/job-interviews/${id}/${action}`, { method: 'POST', body: action === 'decline' ? { reason } : {}, schema: interviewSchema });
export const fetchOrgInterviews = (orgId: string, applicationId: string) => api.request(`/orgs/${orgId}/job-applications/${applicationId}/interviews`, { schema: interviewListSchema });
export const proposeInterview = (orgId: string, applicationId: string, body: { startsAt: string; durationMin: number; location: string }) =>
  api.request(`/orgs/${orgId}/job-applications/${applicationId}/interviews`, { method: 'POST', body, schema: interviewSchema });
export const cancelOrgInterview = (orgId: string, id: string) => api.request(`/orgs/${orgId}/job-interviews/${id}/cancel`, { method: 'POST', schema: interviewSchema });

export const setCvFile = (assetId: string | null) => api.request('/me/job-profile/cv', { method: 'PUT', body: { assetId }, schema: myJobProfileSchema });
