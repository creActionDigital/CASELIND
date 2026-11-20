import { z } from 'zod';

/**
 * Double validation des opérations sensibles (CDC §17 et §26) : quand elle est active, l'opération ne s'exécute pas, elle crée une
 * demande qu'un AUTRE administrateur approuve (l'opération s'exécute alors, une seule fois) ou rejette. Une demande expire après 24 h.
 * La demande ne porte que des identifiants et des valeurs de réglage, jamais de contenu personnel.
 */
export const approvalKindSchema = z.enum(['flag.regulated.change', 'user.platform_role.grant', 'ledger.account.freeze', 'user.suspend.staff', 'sanction.issue', 'setting.sensitive']);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalReasonSchema = z.string().trim().min(3).max(300);

/** Réponse 202 d'une opération sensible mise en attente. */
export const approvalPendingSchema = z.object({ approvalId: z.uuid(), status: z.literal('pending') });
export type ApprovalPending = z.infer<typeof approvalPendingSchema>;

export const adminApprovalSchema = z.object({
  id: z.uuid(),
  kind: approvalKindSchema,
  subjectId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  status: approvalStatusSchema,
  requestedBy: z.uuid(),
  requestedByName: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  executedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type AdminApproval = z.infer<typeof adminApprovalSchema>;

export const adminApprovalListQuerySchema = z.object({
  status: approvalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminApprovalListQuery = z.infer<typeof adminApprovalListQuerySchema>;
export const adminApprovalListSchema = z.object({ items: z.array(adminApprovalSchema) });
export type AdminApprovalList = z.infer<typeof adminApprovalListSchema>;

/** Donner un rôle plateforme : opération sensible (kind `user.platform_role.grant`). */
export const grantPlatformRoleRequestSchema = z.object({ role: z.enum(['moderator', 'support', 'admin']), reason: approvalReasonSchema });
export type GrantPlatformRoleRequest = z.infer<typeof grantPlatformRoleRequestSchema>;
