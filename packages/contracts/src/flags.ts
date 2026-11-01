import { z } from 'zod';
import { platformRoleSchema } from './users.js';

export const flagKeySchema = z
  .string()
  .regex(/^[a-z0-9_.]{1,100}$/, 'flag key must contain only lowercase letters, digits, "_" or "."');

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code');

/** Flags evaluated for the current user: `true` means the feature is available to them. */
export const userFlagsSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
});
export type UserFlags = z.infer<typeof userFlagsSchema>;

/** Full flag definition, as seen by admins. `null` restrictions mean "everyone". */
export const featureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  regulated: z.boolean(),
  allowedCountries: z.array(countryCodeSchema).nullable(),
  allowedRoles: z.array(platformRoleSchema).nullable(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.uuid().nullable(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/**
 * Admin update. On a `regulated` flag, any change leaving it enabled with a new reach (switching
 * it on, or changing allowedCountries/allowedRoles while on) requires `confirmRegulated: true`
 * (otherwise 409 `conflict` with details `{ regulated: true }`). Switching off does not.
 */
export const updateFeatureFlagRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowedCountries: z.array(countryCodeSchema).max(250).nullable().optional(),
    allowedRoles: z.array(platformRoleSchema).nullable().optional(),
    description: z.string().trim().min(1).max(300).optional(),
    confirmRegulated: z.boolean().optional(),
  })
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'confirmRegulated'),
    'at least one field to change is required',
  );
export type UpdateFeatureFlagRequest = z.infer<typeof updateFeatureFlagRequestSchema>;
