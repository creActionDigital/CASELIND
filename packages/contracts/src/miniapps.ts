import { z } from 'zod';

/* Lot 10: mini-app platform. OAuth 2.0 authorization code + PKCE (S256). See docs/architecture/API_CONTRACTS.md and ADR-021. */

export const MINIAPP_SCOPES = ['profile.basic', 'profile.phone', 'profile.email', 'orders.read', 'wallet.pay', 'notify'] as const;
export const miniappScopeSchema = z.enum(MINIAPP_SCOPES);
export type MiniAppScope = z.infer<typeof miniappScopeSchema>;

export const SCOPE_DESCRIPTIONS: Record<MiniAppScope, string> = {
  'profile.basic': 'Votre identifiant, votre nom, votre @pseudo et votre avatar',
  'profile.phone': 'Votre numéro de téléphone vérifié',
  'profile.email': 'Votre adresse e-mail vérifiée',
  'orders.read': 'Vos commandes passées chez l’organisation qui édite cette application',
  'wallet.pay': 'Demander un paiement (sandbox), que vous confirmez toujours avec votre PIN',
  notify: 'Vous envoyer des notifications (5 par jour au plus, que vous pouvez couper)',
};

const scopeListSchema = z
  .array(miniappScopeSchema)
  .min(1)
  .max(MINIAPP_SCOPES.length)
  .refine((a) => new Set(a).size === a.length, 'duplicate scope');

/** https only, no credentials, no fragment. */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'an https URL without credentials or fragment is required');

const redirectUrisSchema = z
  .array(httpsUrlSchema.refine((v) => !v.includes('*'), 'wildcards are not allowed'))
  .min(1)
  .max(10)
  .refine((a) => new Set(a).size === a.length, 'duplicate redirect URI');

export const miniappStatusSchema = z.enum(['draft', 'in_review', 'published', 'rejected', 'suspended']);
export type MiniAppStatus = z.infer<typeof miniappStatusSchema>;

/* ------------------------------------------------------------------ developer apps */

export const createMiniAppRequestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  iconMediaId: z.uuid().nullable().optional(),
  launchUrl: httpsUrlSchema,
  redirectUris: redirectUrisSchema,
  scopes: z.array(miniappScopeSchema).max(MINIAPP_SCOPES.length).default([]),
  /** Confidential apps (default) get a client secret; public ones (pure client-side) rely on PKCE alone. */
  confidential: z.boolean().default(true),
  /** Manifeste declaratif (valide par le serveur avec `miniappManifestSchema` ; obligatoire a la soumission). */
  manifest: z.unknown().optional(),
});
export type CreateMiniAppRequest = z.infer<typeof createMiniAppRequestSchema>;

export const updateMiniAppRequestSchema = createMiniAppRequestSchema
  .omit({ confidential: true, scopes: true })
  .extend({ scopes: z.array(miniappScopeSchema).max(MINIAPP_SCOPES.length) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type UpdateMiniAppRequest = z.infer<typeof updateMiniAppRequestSchema>;

export const miniappSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  launchUrl: z.string(),
  redirectUris: z.array(z.string()),
  scopes: z.array(miniappScopeSchema),
  confidential: z.boolean(),
  clientId: z.string(),
  status: miniappStatusSchema,
  reviewNote: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  /** Version approuvee en cours (null tant qu'aucune version n'a ete approuvee). */
  currentVersion: z.string().nullable().optional(),
  /** Surcharge admin du quota par minute ; null = valeur par defaut de la plateforme. */
  rateLimitPerMinute: z.number().int().nullable().optional(),
  /** Manifeste declaratif de la version approuvee (ou en preparation avant la premiere approbation). */
  manifest: z.unknown().nullable().optional(),
  certification: z.enum(['unreviewed', 'reviewed', 'certified']).optional(),
  certifiedAt: z.iso.datetime().nullable().optional(),
  certificationNote: z.string().nullable().optional(),
  /** Part de la plateforme en points de base (0-3000), fixee par l'administrateur. */
  revenueShareBps: z.number().int().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MiniApp = z.infer<typeof miniappSchema>;

/** Returned once on creation and on rotation: the secret is never readable again. */
export const miniappWithSecretSchema = miniappSchema.extend({ clientSecret: z.string().nullable() });
export type MiniAppWithSecret = z.infer<typeof miniappWithSecretSchema>;

export const miniappListSchema = z.object({ items: z.array(miniappSchema), nextCursor: z.string().nullable() });
export type MiniAppList = z.infer<typeof miniappListSchema>;

export const adminMiniAppListQuerySchema = z.object({
  status: miniappStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type AdminMiniAppListQuery = z.infer<typeof adminMiniAppListQuerySchema>;

export const reviewMiniAppRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.decision !== 'reject' || !!v.note, { message: 'a note is required to reject', path: ['note'] });
export type ReviewMiniAppRequest = z.infer<typeof reviewMiniAppRequestSchema>;

/* ------------------------------------------------------------------ directory */

export const miniappPublicSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  launchUrl: z.string(),
  clientId: z.string(),
  scopes: z.array(miniappScopeSchema),
  /** Version courante affichee dans l'annuaire. */
  version: z.string().nullable().optional(),
  certification: z.enum(['unreviewed', 'reviewed', 'certified']).optional(),
  /** Modele de cout declare (free, per_use, subscription, other). */
  costModel: z.string().nullable().optional(),
  /** Manifeste approuve (detail d'une application seulement ; a valider avec `miniappManifestSchema`). */
  manifest: z.unknown().nullable().optional(),
  organization: z.object({ id: z.uuid(), name: z.string(), verified: z.boolean() }),
});
export type MiniAppPublic = z.infer<typeof miniappPublicSchema>;

export const miniappDirectoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type MiniAppDirectoryQuery = z.infer<typeof miniappDirectoryQuerySchema>;

export const miniappPublicListSchema = z.object({ items: z.array(miniappPublicSchema), nextCursor: z.string().nullable() });
export type MiniAppPublicList = z.infer<typeof miniappPublicListSchema>;

/* ------------------------------------------------------------------ OAuth */

/** S256 challenge: base64url of a SHA-256 digest (43 characters). */
export const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'a base64url SHA-256 (S256) challenge is required');
export const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'invalid code_verifier');

export const authorizePreviewQuerySchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().min(1).max(2000),
  /** Space-separated scopes; empty = every scope the app declares. */
  scopes: z.string().max(300).optional(),
});
export type AuthorizePreviewQuery = z.infer<typeof authorizePreviewQuerySchema>;

export const authorizePreviewSchema = z.object({
  app: miniappPublicSchema.omit({ clientId: true, scopes: true }),
  scopes: z.array(z.object({ scope: miniappScopeSchema, description: z.string(), alreadyGranted: z.boolean() })),
  certification: z.enum(['unreviewed', 'reviewed', 'certified']).optional(),
  /** Manifeste approuve : donnees consultees, couts, conditions (a valider avec `miniappManifestSchema`). */
  manifest: z.unknown().nullable().optional(),
  /** Vrai quand l'utilisateur a deja une autorisation que la version courante oblige a renouveler. */
  reconsentRequired: z.boolean().optional(),
});
export type AuthorizePreview = z.infer<typeof authorizePreviewSchema>;

export const authorizeRequestSchema = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().min(1).max(2000),
  scopes: scopeListSchema,
  state: z.string().min(8).max(500),
  codeChallenge: codeChallengeSchema,
  codeChallengeMethod: z.literal('S256').default('S256'),
});
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;

export const authorizeResponseSchema = z.object({
  code: z.string(),
  state: z.string(),
  redirectTo: z.string(),
  expiresIn: z.number().int(),
});
export type AuthorizeResponse = z.infer<typeof authorizeResponseSchema>;

/** `POST /v1/oauth/token` follows RFC 6749 naming (snake_case); JSON or form-encoded. */
export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(10).max(200),
    code_verifier: codeVerifierSchema,
    redirect_uri: z.string().min(1).max(2000),
    client_id: z.string().min(1).max(100),
    client_secret: z.string().min(1).max(200).optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(10).max(200),
    client_id: z.string().min(1).max(100),
    client_secret: z.string().min(1).max(200).optional(),
  }),
]);
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  scope: z.string(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/* ------------------------------------------------------------------ user grants */

export const miniappGrantSchema = z.object({
  appId: z.uuid(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  organizationName: z.string(),
  scopes: z.array(miniappScopeSchema),
  grantedAt: z.iso.datetime(),
  /** Une version approuvee a ajoute des scopes : l'utilisateur doit consentir de nouveau pour qu'ils soient couverts. */
  reconsentRequired: z.boolean().optional(),
  /** Vrai quand l'utilisateur a coupe les notifications de cette application. */
  notificationsMuted: z.boolean().optional(),
});
export type MiniAppGrant = z.infer<typeof miniappGrantSchema>;
export const miniappGrantListSchema = z.object({ items: z.array(miniappGrantSchema) });
export type MiniAppGrantList = z.infer<typeof miniappGrantListSchema>;

/** Exported grants include revoked ones (history). */
export const exportedMiniAppGrantSchema = z.object({
  appId: z.uuid(),
  appName: z.string(),
  scopes: z.array(z.string()),
  grantedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ExportedMiniAppGrant = z.infer<typeof exportedMiniAppGrantSchema>;

/* ------------------------------------------------------------------ resources reachable with an app token */

export const miniappMeSchema = z.object({
  /** Identifiant propre a cette application (different pour chaque application, stable) : jamais l'identifiant global. */
  id: z.string(),
  displayName: z.string(),
  handle: z.string(),
  avatarUrl: z.string().nullable(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});
export type MiniAppMe = z.infer<typeof miniappMeSchema>;

export const miniappOrderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.string(),
  currency: z.string(),
  totalMinor: z.number().int(),
  createdAt: z.iso.datetime(),
});
export const miniappOrderListSchema = z.object({ items: z.array(miniappOrderSchema), nextCursor: z.string().nullable() });
export type MiniAppOrderList = z.infer<typeof miniappOrderListSchema>;

export const miniappPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type MiniAppPageQuery = z.infer<typeof miniappPageQuerySchema>;

export const createMiniAppPaymentRequestSchema = z.object({
  /** Idempotency key chosen by the app: the same ref returns the same request. */
  clientRef: z.string().trim().min(1).max(64),
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code expected'),
  description: z.string().trim().max(200).nullable().optional(),
});
export type CreateMiniAppPaymentRequest = z.infer<typeof createMiniAppPaymentRequestSchema>;

export const miniappPaymentRequestSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  appName: z.string(),
  clientRef: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  description: z.string().nullable(),
  status: z.enum(['pending', 'paid', 'declined', 'cancelled', 'expired']),
  expiresAt: z.iso.datetime(),
  transferId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type MiniAppPaymentRequest = z.infer<typeof miniappPaymentRequestSchema>;
export const miniappPaymentRequestListSchema = z.object({ items: z.array(miniappPaymentRequestSchema) });
export type MiniAppPaymentRequestList = z.infer<typeof miniappPaymentRequestListSchema>;

export const confirmMiniAppPaymentRequestSchema = z.object({ pin: z.string().min(1).max(16) });
export type ConfirmMiniAppPaymentRequest = z.infer<typeof confirmMiniAppPaymentRequestSchema>;
