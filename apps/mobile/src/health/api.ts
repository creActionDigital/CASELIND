import {
  doseListSchema,
  doseSchema,
  healthConsentSchema,
  healthEntryListSchema,
  healthEntrySchema,
  HEALTH_CONSENT_VERSION,
  reminderListSchema,
  reminderSchema,
  type CreateHealthEntryRequest,
  type CreateReminderRequest,
  type HealthEntryKind,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 30;

export const healthKeys = {
  all: ['health'] as const,
  consent: ['health', 'consent'] as const,
  entries: (kind: string) => ['health', 'entries', kind] as const,
  reminders: ['health', 'reminders'] as const,
  doses: ['health', 'doses'] as const,
};

export const fetchConsent = () => api.request('/me/health/consent', { schema: healthConsentSchema });
export const grantConsent = () => api.request('/me/health/consent', { method: 'PUT', body: { version: HEALTH_CONSENT_VERSION }, schema: healthConsentSchema });
export const revokeConsent = () => api.request('/me/health/consent', { method: 'DELETE', schema: healthConsentSchema });
export const eraseHealthData = () => api.request('/me/health/data', { method: 'DELETE' });

export const fetchEntries = (kind: HealthEntryKind | '', cursor?: string) =>
  api.request('/me/health/entries', { query: { kind: kind || undefined, limit: PAGE, cursor }, schema: healthEntryListSchema });
export const createEntry = (body: CreateHealthEntryRequest) => api.request('/me/health/entries', { method: 'POST', body, schema: healthEntrySchema });
export const deleteEntry = (id: string) => api.request(`/me/health/entries/${id}`, { method: 'DELETE' });

export const fetchReminders = () => api.request('/me/health/reminders', { schema: reminderListSchema });
export const createReminder = (body: CreateReminderRequest) => api.request('/me/health/reminders', { method: 'POST', body, schema: reminderSchema });
export const setReminderActive = (id: string, active: boolean) => api.request(`/me/health/reminders/${id}`, { method: 'PATCH', body: { active }, schema: reminderSchema });
export const deleteReminder = (id: string) => api.request(`/me/health/reminders/${id}`, { method: 'DELETE' });

export const fetchDoses = () => api.request('/me/health/doses', { schema: doseListSchema });
export const resolveDose = (id: string, status: 'taken' | 'skip') => api.request(`/me/health/doses/${id}/${status}`, { method: 'POST', schema: doseSchema });
