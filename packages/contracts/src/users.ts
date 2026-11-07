import { z } from 'zod';
import { localeSchema } from './auth.js';

export const handleSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.]{3,30}$/, 'handle must be 3-30 characters: letters, digits, "_" or "."');

export const platformRoleSchema = z.enum(['user', 'moderator', 'support', 'admin']);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  locale: localeSchema,
  country: z.string().nullable(),
  roles: z.array(platformRoleSchema),
  status: z.enum(['pending_verification', 'active', 'suspended', 'deleted']),
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Me = z.infer<typeof meSchema>;

export const updateMeRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    handle: handleSchema,
    bio: z.string().trim().max(300).nullable(),
    locale: localeSchema,
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const publicProfileSchema = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const securityEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  occurredAt: z.iso.datetime(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SecurityEvent = z.infer<typeof securityEventSchema>;
