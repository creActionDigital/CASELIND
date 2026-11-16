import { z } from 'zod';

/**
 * Platform governance (found missing by the conformity audit, G1): an administrator suspends or reactivates an account or an
 * organisation and sets the verification of an organisation. A reason is mandatory and the action is audited.
 */
const reason = z.string().trim().min(3).max(500);

export const setUserStatusRequestSchema = z.object({ status: z.enum(['active', 'suspended']), reason });
export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;

export const setOrgStatusRequestSchema = z.object({ status: z.enum(['active', 'suspended']), reason });
export type SetOrgStatusRequest = z.infer<typeof setOrgStatusRequestSchema>;

export const setOrgVerificationRequestSchema = z.object({ status: z.enum(['unverified', 'pending', 'verified']), reason: reason.optional() });
export type SetOrgVerificationRequest = z.infer<typeof setOrgVerificationRequestSchema>;

export const adminListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const adminUserSchema = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), status: z.string(), roles: z.array(z.string()), createdAt: z.string() });
export type AdminUser = z.infer<typeof adminUserSchema>;
export const adminUserListSchema = z.object({ items: z.array(adminUserSchema) });
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const adminOrgSchema = z.object({ id: z.uuid(), slug: z.string(), name: z.string(), kind: z.string(), status: z.string(), verificationStatus: z.string(), createdAt: z.string() });
export type AdminOrg = z.infer<typeof adminOrgSchema>;
export const adminOrgListSchema = z.object({ items: z.array(adminOrgSchema) });
export type AdminOrgList = z.infer<typeof adminOrgListSchema>;
