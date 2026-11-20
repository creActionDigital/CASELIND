import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Administration principale, suite (CDC §26) : sanctions graduées et recours, annonces de la plateforme,
 * paramètres par pays et ville, commissions (relevé indicatif, aucun prélèvement réel).
 */

const iso = z.iso.datetime();
const note = z.string().trim().max(300);

/* ---------------------------------------------------------------- sanctions et recours */

export const sanctionKindSchema = z.enum(['warning', 'mute_posting', 'suspension_temp', 'ban']);
export type SanctionKind = z.infer<typeof sanctionKindSchema>;
export const sanctionStatusSchema = z.enum(['active', 'lifted', 'expired', 'appealed']);
export type SanctionStatus = z.infer<typeof sanctionStatusSchema>;
export const appealStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type AppealStatus = z.infer<typeof appealStatusSchema>;

/** Durée en jours, par type : `null` = pas de durée (avertissement, bannissement). */
export const SANCTION_DURATION_DAYS: Record<SanctionKind, { min: number; max: number } | null> = {
  warning: null,
  mute_posting: { min: 7, max: 30 },
  suspension_temp: { min: 1, max: 30 },
  ban: null,
};
/** Une suspension plus longue que cela, ou un bannissement, visant un compte du personnel passe par la double validation. */
export const LONG_SUSPENSION_DAYS = 7;

export const issueSanctionRequestSchema = z
  .object({
    kind: sanctionKindSchema,
    reason: z.string().trim().min(3).max(300),
    durationDays: z.number().int().optional(),
    /** Signalement à l'origine de la sanction (facultatif). */
    reportId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const d = SANCTION_DURATION_DAYS[v.kind];
    if (!d) {
      if (v.durationDays !== undefined) ctx.addIssue({ code: 'custom', path: ['durationDays'], message: 'no duration for this kind' });
    } else if (v.durationDays === undefined || v.durationDays < d.min || v.durationDays > d.max) {
      ctx.addIssue({ code: 'custom', path: ['durationDays'], message: `duration must be ${d.min} to ${d.max} days` });
    }
  });
export type IssueSanctionRequest = z.infer<typeof issueSanctionRequestSchema>;

export const sanctionAppealSummarySchema = z.object({
  id: z.uuid(),
  status: appealStatusSchema,
  decisionNote: z.string().nullable(),
});

export const sanctionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userHandle: z.string().nullable(),
  kind: sanctionKindSchema,
  reason: z.string(),
  reportId: z.uuid().nullable(),
  /** Absent côté utilisateur. */
  issuedBy: z.uuid().nullable(),
  startsAt: iso,
  endsAt: iso.nullable(),
  /** Statut effectif : une sanction dont la fin est passée se lit `expired` avant même le passage de la maintenance. */
  status: sanctionStatusSchema,
  liftedAt: iso.nullable(),
  appeal: sanctionAppealSummarySchema.nullable(),
  createdAt: iso,
});
export type Sanction = z.infer<typeof sanctionSchema>;
export const sanctionListSchema = z.object({ items: z.array(sanctionSchema), nextCursor: z.string().nullable() });
export type SanctionList = z.infer<typeof sanctionListSchema>;
export const sanctionListQuerySchema = pageQuerySchema.extend({
  status: sanctionStatusSchema.optional(),
  userId: z.uuid().optional(),
});
export type SanctionListQuery = z.infer<typeof sanctionListQuerySchema>;

export const liftSanctionRequestSchema = z.object({ note: note.optional() });
export type LiftSanctionRequest = z.infer<typeof liftSanctionRequestSchema>;

export const appealRequestSchema = z.object({ message: z.string().trim().min(1).max(1000) });
export type AppealRequest = z.infer<typeof appealRequestSchema>;

export const adminAppealSchema = z.object({
  id: z.uuid(),
  sanctionId: z.uuid(),
  userId: z.uuid(),
  userHandle: z.string().nullable(),
  message: z.string(),
  status: appealStatusSchema,
  decisionNote: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  createdAt: iso,
  sanctionKind: sanctionKindSchema,
  sanctionReason: z.string(),
  sanctionStatus: sanctionStatusSchema,
});
export type AdminAppeal = z.infer<typeof adminAppealSchema>;
export const adminAppealListSchema = z.object({ items: z.array(adminAppealSchema), nextCursor: z.string().nullable() });
export type AdminAppealList = z.infer<typeof adminAppealListSchema>;
export const adminAppealListQuerySchema = pageQuerySchema.extend({ status: appealStatusSchema.optional() });
export type AdminAppealListQuery = z.infer<typeof adminAppealListQuerySchema>;

export const decideAppealRequestSchema = z.object({ decision: z.enum(['accepted', 'rejected']), note: note.optional() });
export type DecideAppealRequest = z.infer<typeof decideAppealRequestSchema>;

/** Sanctions et recours d'un compte, dans l'export de ses données. */
export const exportedSanctionSchema = z.object({
  id: z.uuid(),
  kind: sanctionKindSchema,
  reason: z.string(),
  status: sanctionStatusSchema,
  startsAt: iso,
  endsAt: iso.nullable(),
  createdAt: iso,
  appeal: z.object({ message: z.string(), status: appealStatusSchema, decisionNote: z.string().nullable(), createdAt: iso }).nullable(),
});
export type ExportedSanction = z.infer<typeof exportedSanctionSchema>;

/* ---------------------------------------------------------------- annonces */

export const announcementAudienceSchema = z.string().regex(/^(all|role:(user|moderator|support|admin)|country:[A-Z]{2})$/);
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;
export const announcementStatusSchema = z.enum(['draft', 'published', 'ended']);
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;

export const createPlatformAnnouncementRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(500),
    audience: announcementAudienceSchema.default('all'),
    startsAt: iso.optional(),
    endsAt: iso,
  })
  .refine((v) => !v.startsAt || new Date(v.endsAt) > new Date(v.startsAt), { path: ['endsAt'], message: 'endsAt must be after startsAt' });
export type CreatePlatformAnnouncementRequest = z.infer<typeof createPlatformAnnouncementRequestSchema>;

/** Seul un brouillon se modifie. */
export const updateAnnouncementRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(500),
    audience: announcementAudienceSchema,
    startsAt: iso,
    endsAt: iso,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>;

export const adminAnnouncementSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  audience: announcementAudienceSchema,
  startsAt: iso,
  endsAt: iso,
  status: announcementStatusSchema,
  publishedAt: iso.nullable(),
  createdAt: iso,
});
export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>;
export const adminAnnouncementListQuerySchema = pageQuerySchema.extend({ status: announcementStatusSchema.optional() });
export type AdminAnnouncementListQuery = z.infer<typeof adminAnnouncementListQuerySchema>;
export const adminAnnouncementListSchema = z.object({ items: z.array(adminAnnouncementSchema), nextCursor: z.string().nullable() });
export type AdminAnnouncementList = z.infer<typeof adminAnnouncementListSchema>;

export const platformAnnouncementSchema = z.object({ id: z.uuid(), title: z.string(), body: z.string(), startsAt: iso, endsAt: iso });
export type PlatformAnnouncement = z.infer<typeof platformAnnouncementSchema>;
export const platformAnnouncementListSchema = z.object({ items: z.array(platformAnnouncementSchema), nextCursor: z.string().nullable() });
export type PlatformAnnouncementList = z.infer<typeof platformAnnouncementListSchema>;

/* ---------------------------------------------------------------- paramètres par pays et ville */

export const COMMISSION_MAX_BPS = 3000;

export const settingKeySchema = z.enum(['support.contact', 'currencies.enabled', 'cities.pilot', 'commission.defaultBps', 'limits.maxOrderMinor']);
export type SettingKey = z.infer<typeof settingKeySchema>;
/** `global`, `country:CD` ou `city:CD:Goma`. */
export const settingScopeSchema = z.string().regex(/^(global|country:[A-Z]{2}|city:[A-Z]{2}:[^:]{1,60})$/);
export type SettingScope = z.infer<typeof settingScopeSchema>;

const supportContactSchema = z
  .object({
    email: z.email().max(120).optional(),
    phone: z.string().trim().min(3).max(30).optional(),
    whatsapp: z.string().trim().min(3).max(30).optional(),
    hours: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => !!(v.email || v.phone || v.whatsapp), { message: 'at least one contact channel' });

/** Valeur acceptée pour chaque clé (liste blanche : une autre clé est refusée). */
export const settingValueSchemas = {
  'support.contact': supportContactSchema,
  'currencies.enabled': z.array(z.enum(['USD', 'CDF'])).min(1).max(2),
  'cities.pilot': z.array(z.string().trim().min(1).max(60)).max(50),
  'commission.defaultBps': z.number().int().min(0).max(COMMISSION_MAX_BPS),
  'limits.maxOrderMinor': z.number().int().min(1).max(1_000_000_000_000),
} as const satisfies Record<SettingKey, z.ZodType>;

/** Portées admises par clé (la ville ne sert qu'aux coordonnées d'assistance). */
export const SETTING_SCOPES: Record<SettingKey, readonly ('global' | 'country' | 'city')[]> = {
  'support.contact': ['global', 'country', 'city'],
  'currencies.enabled': ['global', 'country'],
  'cities.pilot': ['global', 'country'],
  'commission.defaultBps': ['global', 'country'],
  'limits.maxOrderMinor': ['global', 'country'],
};

/** Réglages dont le changement passe par la double validation. */
export const isSensitiveSetting = (key: string): boolean => key === 'commission.defaultBps' || key.startsWith('limits.');

export const putSettingRequestSchema = z
  .object({ key: settingKeySchema, scope: settingScopeSchema.default('global'), value: z.unknown(), reason: z.string().trim().min(3).max(300) })
  .superRefine((v, ctx) => {
    const kind = v.scope.split(':')[0] as 'global' | 'country' | 'city';
    if (!SETTING_SCOPES[v.key].includes(kind)) ctx.addIssue({ code: 'custom', path: ['scope'], message: 'scope not allowed for this key' });
    const parsed = settingValueSchemas[v.key].safeParse(v.value);
    if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['value'], message: parsed.error.issues[0]?.message ?? 'invalid value' });
  });
export type PutSettingRequest = z.infer<typeof putSettingRequestSchema>;

export const adminSettingSchema = z.object({ key: settingKeySchema, scope: settingScopeSchema, value: z.unknown(), updatedBy: z.uuid().nullable(), updatedAt: iso });
export type AdminSetting = z.infer<typeof adminSettingSchema>;
export const adminSettingListQuerySchema = z.object({ key: settingKeySchema.optional() });
export type AdminSettingListQuery = z.infer<typeof adminSettingListQuerySchema>;
export const adminSettingListSchema = z.object({ items: z.array(adminSettingSchema) });
export type AdminSettingList = z.infer<typeof adminSettingListSchema>;

/** Lecture publique : seulement les clés non sensibles, résolues pour le pays demandé (pays avant global). */
export const publicConfigQuerySchema = z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional(), city: z.string().trim().min(1).max(60).optional() });
export type PublicConfigQuery = z.infer<typeof publicConfigQuerySchema>;
export const publicConfigSchema = z.object({
  supportContact: supportContactSchema.nullable(),
  currenciesEnabled: z.array(z.enum(['USD', 'CDF'])).nullable(),
  pilotCities: z.array(z.string()).nullable(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

/* ---------------------------------------------------------------- commissions (relevé indicatif) */

export const commissionCurrencySchema = z.enum(['USD', 'CDF']);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const commissionTotalSchema = z.object({ currency: commissionCurrencySchema, orders: z.number().int(), grossMinor: z.number().int(), commissionMinor: z.number().int() });
export type CommissionTotal = z.infer<typeof commissionTotalSchema>;

export const commissionLineSchema = z.object({
  orderId: z.uuid(),
  orderNumber: z.string(),
  grossMinor: z.number().int(),
  bps: z.number().int(),
  commissionMinor: z.number().int(),
  currency: commissionCurrencySchema,
  createdAt: iso,
});
export type CommissionLine = z.infer<typeof commissionLineSchema>;

export const commissionQuerySchema = z.object({ from: day.optional(), to: day.optional() });
export type CommissionQuery = z.infer<typeof commissionQuerySchema>;
export const orgCommissionQuerySchema = pageQuerySchema.extend({ from: day.optional(), to: day.optional() });
export type OrgCommissionQuery = z.infer<typeof orgCommissionQuerySchema>;

/** Relevé du vendeur : relevé indicatif, aucun prélèvement réel. */
export const orgCommissionStatementSchema = z.object({
  indicative: z.literal(true),
  /** Taux appliqué aux prochaines livraisons (surcharge de l'organisation, sinon réglage de la plateforme). */
  currentBps: z.number().int(),
  totals: z.array(commissionTotalSchema),
  items: z.array(commissionLineSchema),
  nextCursor: z.string().nullable(),
});
export type OrgCommissionStatement = z.infer<typeof orgCommissionStatementSchema>;

export const adminCommissionStatementSchema = z.object({
  indicative: z.literal(true),
  from: day,
  to: day,
  totals: z.array(commissionTotalSchema),
  byOrg: z.array(z.object({ orgId: z.uuid(), orgName: z.string(), currency: commissionCurrencySchema, orders: z.number().int(), grossMinor: z.number().int(), commissionMinor: z.number().int() })),
});
export type AdminCommissionStatement = z.infer<typeof adminCommissionStatementSchema>;

/** Surcharge du taux d'une organisation (`null` = reprendre le taux de la plateforme). */
export const setOrgCommissionRequestSchema = z.object({ bps: z.number().int().min(0).max(COMMISSION_MAX_BPS).nullable(), reason: z.string().trim().min(3).max(300) });
export type SetOrgCommissionRequest = z.infer<typeof setOrgCommissionRequestSchema>;

/** Commission arrondie à l'unité mineure la plus proche (demi vers le haut), en entiers. */
export const commissionMinor = (grossMinor: number, bps: number): number => Math.floor((grossMinor * bps + 5000) / 10_000);
