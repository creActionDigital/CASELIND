import {
  accessLogSchema,
  healthAvailabilitySchema,
  healthSlotListSchema,
  type SetHealthAvailabilityRequest,
  appointmentListSchema,
  appointmentSchema,
  myProfessionalSchema,
  prescriptionListSchema,
  prescriptionSchema,
  professionalListSchema,
  shareListSchema,
  shareSchema,
  sharedPatientsSchema,
  sharedRecordSchema,
  type ApplyProfessionalRequest,
  type CreateAppointmentRequest,
  type CreatePrescriptionRequest,
  type CreateShareRequest,
  type ProfessionalKind,
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

// ---- Lot 18b : professionnels, rendez-vous, partage, ordonnances -------------------------------

export const proKeys = {
  directory: (kind: string) => ['health', 'directory', kind] as const,
  mine: ['health', 'pro', 'mine'] as const,
  appointments: ['health', 'appointments'] as const,
  proAppointments: ['health', 'pro', 'appointments'] as const,
  shares: ['health', 'shares'] as const,
  accessLog: ['health', 'access-log'] as const,
  patients: ['health', 'pro', 'patients'] as const,
  record: (id: string) => ['health', 'pro', 'record', id] as const,
  prescriptions: ['health', 'prescriptions'] as const,
};

export const fetchDirectory = (kind: ProfessionalKind | '', cursor?: string) =>
  api.request('/health-professionals', { query: { kind: kind || undefined, limit: PAGE, cursor }, schema: professionalListSchema });
export const fetchMyProfessional = () => api.request('/me/health/professional', { schema: myProfessionalSchema });
export const applyAsProfessional = (body: ApplyProfessionalRequest) => api.request('/me/health/professional', { method: 'PUT', body, schema: myProfessionalSchema });

export const bookAppointment = (body: CreateAppointmentRequest) => api.request('/me/health/appointments', { method: 'POST', body, schema: appointmentSchema });
export const fetchMyAppointments = (cursor?: string) => api.request('/me/health/appointments', { query: { limit: PAGE, cursor }, schema: appointmentListSchema });
export const fetchProAppointments = (cursor?: string) => api.request('/me/health/professional/appointments', { query: { limit: PAGE, cursor }, schema: appointmentListSchema });
export const actOnAppointment = (id: string, action: 'confirm' | 'decline' | 'cancel' | 'complete') => api.request(`/health/appointments/${id}/${action}`, { method: 'POST', schema: appointmentSchema });

export const createShare = (body: CreateShareRequest) => api.request('/me/health/shares', { method: 'POST', body, schema: shareSchema });
export const fetchShares = () => api.request('/me/health/shares', { schema: shareListSchema });
export const revokeShare = (id: string) => api.request(`/me/health/shares/${id}`, { method: 'DELETE', schema: shareSchema });
export const fetchAccessLog = () => api.request('/me/health/access-log', { schema: accessLogSchema });
export const fetchSharedPatients = () => api.request('/me/health/professional/patients', { schema: sharedPatientsSchema });
export const fetchSharedRecord = (patientId: string) => api.request(`/me/health/professional/patients/${patientId}/record`, { schema: sharedRecordSchema });

export const prescribe = (appointmentId: string, body: CreatePrescriptionRequest) =>
  api.request(`/me/health/professional/appointments/${appointmentId}/prescription`, { method: 'POST', body, schema: prescriptionSchema });
export const fetchPrescriptions = () => api.request('/me/health/prescriptions', { schema: prescriptionListSchema });

// ---- Lot 18c : disponibilités, créneaux libres, agenda -------------------------------------------

export const availabilityKeys = { mine: ['health', 'pro', 'availability'] as const, agenda: ['health', 'pro', 'agenda'] as const, slots: (id: string) => ['health', 'slots', id] as const };
export const fetchAvailability = () => api.request('/me/health/professional/availability', { schema: healthAvailabilitySchema });
export const saveAvailability = (body: SetHealthAvailabilityRequest) => api.request('/me/health/professional/availability', { method: 'PUT', body, schema: healthAvailabilitySchema });
export const fetchAgenda = () => api.request('/me/health/professional/agenda', { schema: appointmentListSchema });
export const fetchSlots = (professionalId: string) => api.request(`/health-professionals/${professionalId}/slots`, { schema: healthSlotListSchema });
