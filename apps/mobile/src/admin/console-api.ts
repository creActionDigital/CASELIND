import {
  adminAiModelListSchema,
  adminAiModelSchema,
  adminDriverListSchema,
  adminGameQuestionListSchema,
  adminGameQuestionSchema,
  adminKycListSchema,
  adminKycSubmissionSchema,
  adminLedgerAccountSchema,
  adminProfessionalListSchema,
  featureFlagSchema,
  ledgerReconciliationSchema,
  miniappListSchema,
  moderationActionResultSchema,
  moderationReportGroupPageSchema,
  tournamentSchema,
  type ReportTargetType,
} from '@caselind/contracts';
import { z } from 'zod';
import { api } from '../auth/auth-context';
import type { Decision, ModAction } from './console-logic';

export const cck = {
  all: ['admin-console'] as const,
  list: (name: string, ...rest: (string | number)[]) => ['admin-console', name, ...rest] as const,
};

type Q = Record<string, string | number | undefined>;
const page = (cursor?: string): Q => (cursor ? { cursor } : {});

// Modération (admin, moderator)
export const fetchModeration = (q: Record<string, string>, cursor?: string) =>
  api.request('/admin/moderation/reports', { query: { ...q, ...page(cursor) }, schema: moderationReportGroupPageSchema });
export const moderate = (b: { targetType: ReportTargetType; targetId: string; action: ModAction; note?: string }) =>
  api.request('/admin/moderation/actions', { method: 'POST', body: b, schema: moderationActionResultSchema });

// Drapeaux (admin)
export const fetchFlags = () => api.request('/admin/flags', { schema: z.object({ items: z.array(featureFlagSchema) }) });
export const updateFlag = (key: string, body: { enabled?: boolean; allowedCountries?: string[] | null; allowedRoles?: string[] | null; confirmRegulated?: boolean }) =>
  // 202 `{ approvalId, status: 'pending' }` quand la double validation est active (module réglementé activé ou désactivé).
  api.request(`/admin/flags/${encodeURIComponent(key)}`, { method: 'PUT', body, schema: z.union([featureFlagSchema, z.object({ approvalId: z.string(), status: z.literal('pending') })]) });

// KYC (admin)
export const fetchKyc = (status: string, cursor?: string) => api.request('/admin/kyc/submissions', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminKycListSchema });
export const decideKyc = (id: string, decision: 'approve' | 'reject', reason?: string) =>
  api.request(`/admin/kyc/submissions/${id}/decision`, { method: 'POST', body: { decision, reason: reason || undefined } });

// Journal d'audit (admin) : le schéma ne retient que les champs non sensibles (zod retire ip, userAgent, metadata).
const auditPageSchema = z.object({
  items: z.array(z.object({ id: z.string(), action: z.string(), occurredAt: z.string(), actorUserId: z.string().nullable().optional(), subjectUserId: z.string().nullable().optional(), requestId: z.string().nullable().optional() })),
  nextCursor: z.string().nullable(),
});
export const fetchAudit = (q: Record<string, string>, before?: string) => api.request('/admin/audit-events', { query: { ...q, ...(before ? { before } : {}) }, schema: auditPageSchema });

/** Compteur du hub : première page de 100 éléments en attente (« 100+ » s'il en reste). Aucune route de comptage dédiée. */
export async function fetchPendingCount(kind: 'moderation' | 'kyc' | 'miniapps'): Promise<{ n: number; more: boolean }> {
  const p =
    kind === 'moderation'
      ? await api.request('/admin/moderation/reports', { query: { status: 'open', limit: 100 }, schema: moderationReportGroupPageSchema })
      : kind === 'kyc'
        ? await api.request('/admin/kyc/submissions', { query: { status: 'pending', limit: 100 }, schema: adminKycListSchema })
        : await api.request('/admin/miniapps', { query: { status: 'in_review', limit: 100 }, schema: miniappListSchema });
  return { n: p.items.length, more: p.nextCursor !== null };
}

// Rapprochement du ledger (admin, lecture seule)
export const fetchReconcile = () => api.request('/admin/ledger/reconcile', { schema: ledgerReconciliationSchema });

// Mini-apps (admin, moderator)
export const fetchMiniapps = (status: string, cursor?: string) => api.request('/admin/miniapps', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: miniappListSchema });
export const reviewMiniapp = (id: string, decision: Decision, note?: string) => api.request(`/admin/miniapps/${id}/review`, { method: 'POST', body: { decision, note: note || undefined } });

// Santé : professionnels (admin)
export const fetchPros = (status: string, cursor?: string) => api.request('/admin/health/professionals', { query: { status: status || undefined, limit: 20, ...page(cursor) }, schema: adminProfessionalListSchema });
export const reviewPro = (userId: string, decision: 'approve' | 'reject' | 'suspend', note: string) => api.request(`/admin/health/professionals/${userId}/review`, { method: 'POST', body: { decision, note } });

// Mobilité : chauffeurs (admin ; pas de curseur côté API, limite 100 au plus)
export const fetchDrivers = (status: string) => api.request('/admin/mobility/drivers', { query: { status: status || undefined, limit: 100 }, schema: adminDriverListSchema });
export const decideDriver = (userId: string, decision: 'approve' | 'reject' | 'suspend', reason?: string) => api.request(`/admin/mobility/drivers/${userId}/decision`, { method: 'POST', body: { decision, reason: reason || undefined } });

// Jeux : questions (admin, sans pagination)
export const fetchQuestions = () => api.request('/admin/games/questions', { schema: adminGameQuestionListSchema });
export const setQuestionActive = (id: string, active: boolean) => api.request(`/admin/games/questions/${id}`, { method: 'PATCH', body: { active }, schema: adminGameQuestionSchema });

// IA : modèles (admin)
export const fetchAiModels = () => api.request('/admin/ai/models', { schema: adminAiModelListSchema });
export const setAiModel = (id: string, enabled: boolean) => api.request(`/admin/ai/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled }, schema: adminAiModelSchema });

// Actions d'administration sans écran jusqu'ici (admin ; clôture des pubs : admin ou modérateur)
export const settleAds = () => api.request('/admin/ads/settle', { method: 'POST', body: {}, schema: z.object({ settled: z.number().int() }) });
export const renewDueSubscriptions = () => api.request('/admin/subscriptions/renew-due', { method: 'POST', body: {}, schema: z.object({ renewed: z.number().int() }) });
/** Ouvre un tournoi (titre, début, fin en ISO 8601). */
export const createTournament = (body: { title: string; startsAt: string; endsAt: string }) => api.request('/admin/games/tournaments', { method: 'POST', body, schema: tournamentSchema });
/** Lecture d'une demande KYC : tracée côté serveur (kyc.viewed), à appeler quand l'admin ouvre les justificatifs. */
export const fetchKycSubmission = (id: string) => api.request(`/admin/kyc/submissions/${id}`, { schema: adminKycSubmissionSchema });
export const fetchLedgerAccount = (id: string) => api.request(`/admin/ledger/accounts/${id}`, { schema: adminLedgerAccountSchema });
const pendingApprovalSchema = z.object({ approvalId: z.string(), status: z.literal('pending') });
/** 200 : compte à jour ; 202 `{ approvalId, status: 'pending' }` quand la double validation est active. */
export const setLedgerAccountFrozen = (id: string, frozen: boolean) =>
  api.request(`/admin/ledger/accounts/${id}/${frozen ? 'freeze' : 'unfreeze'}`, { method: 'POST', body: {}, schema: z.union([adminLedgerAccountSchema, pendingApprovalSchema]) });
