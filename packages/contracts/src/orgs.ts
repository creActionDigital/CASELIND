import { z } from 'zod';
import { handleSchema } from './users.js';
import { type Page, pageQuerySchema } from './pagination.js';

/**
 * Organisations (lot 2a): businesses and establishments with members, per-org roles and a
 * public storefront page. Mirrors migrations/0005_organizations.sql.
 */

/** Kind of business. Only picks defaults and wording on clients; nothing server-side is kind-specific. */
export const orgKindSchema = z.enum([
  'shop',
  'restaurant',
  'hotel',
  'pharmacy',
  'fuel_station',
  'school',
  'hospital',
  'services',
  'warehouse',
  'other',
]);
export type OrgKind = z.infer<typeof orgKindSchema>;

/** Per-org roles (CDC §4). Permissions per role live server-side (apps/api/src/orgs/org-permissions.ts). */
export const orgRoleSchema = z.enum([
  'owner',
  'admin',
  'manager',
  'finance',
  'stock',
  'sales',
  'hr',
  'support',
  'delivery',
  'employee',
]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const orgVisibilitySchema = z.enum(['public', 'private']);
export const orgStatusSchema = z.enum(['active', 'suspended']);
export const orgVerificationStatusSchema = z.enum(['unverified', 'pending', 'verified']);
export const orgMemberStatusSchema = z.enum(['invited', 'active']);
export type OrgMemberStatus = z.infer<typeof orgMemberStatusSchema>;

/** Slugs that would collide with platform URLs or sub-domains. */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'www', 'mail', 'help', 'support', 'status', 'static', 'cdn', 'assets',
  'caselind', 'casalind', 'official', 'security', 'login', 'signup', 'settings', 'orgs', 'me',
]);

/** 3-40 chars, lowercase letters, digits and inner hyphens. Input is lower-cased first. */
export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'slug must be 3-40 characters: a-z, 0-9 and inner "-"')
  .refine((s) => !RESERVED_SLUGS.has(s), 'this slug is reserved');

const HH_MM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;

/**
 * One opening interval, same day, `open` < `close`. "24:00" closes at midnight; a night that
 * runs past midnight is two intervals (e.g. fri 20:00-24:00 and sat 00:00-02:00).
 */
export const openingIntervalSchema = z
  .object({
    open: z.string().regex(HH_MM, 'expected HH:MM'),
    close: z.string().regex(HH_MM, 'expected HH:MM'),
  })
  .refine((i) => i.open < i.close, { message: 'open must be before close', path: ['close'] });

/** Up to 4 non-overlapping intervals per day, sorted by opening time. */
const dayHoursSchema = z
  .array(openingIntervalSchema)
  .max(4)
  .refine((day) => day.every((iv, i) => i === 0 || day[i - 1]!.close <= iv.open), 'intervals must be sorted and must not overlap');

/** Weekly opening hours. A missing or empty day means closed that day. Unknown keys are rejected. */
export const openingHoursSchema = z.strictObject({
  mon: dayHoursSchema.optional(),
  tue: dayHoursSchema.optional(),
  wed: dayHoursSchema.optional(),
  thu: dayHoursSchema.optional(),
  fri: dayHoursSchema.optional(),
  sat: dayHoursSchema.optional(),
  sun: dayHoursSchema.optional(),
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/** https only: a storefront never links to a plain-http site. */
export const orgWebsiteSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'website must be an https:// URL');

/**
 * Mini-site content of the storefront (CDC §5): links, served areas, free sections (conditions, about...) and
 * questions/answers written by the business. Replaced as a whole by PATCH; the caps keep a page readable.
 */
export const orgPageSchema = z.object({
  links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: orgWebsiteSchema })).max(8),
  serviceAreas: z.array(z.string().trim().min(1).max(60)).max(10),
  sections: z.array(z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(2000) })).max(10),
  faq: z.array(z.object({ question: z.string().trim().min(1).max(200), answer: z.string().trim().min(1).max(1000) })).max(20),
});
export type OrgPage = z.infer<typeof orgPageSchema>;
export const EMPTY_ORG_PAGE: OrgPage = { links: [], serviceAreas: [], sections: [], faq: [] };

/** Fields an organisation can edit about itself. Status and verification are platform-controlled. */
const orgEditableFields = {
  name: z.string().trim().min(1).max(120),
  kind: orgKindSchema,
  description: z.string().trim().max(2000).nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  city: z.string().trim().min(1).max(120).nullable(),
  address: z.string().trim().min(1).max(300).nullable(),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'phone must be E.164 (+243...)').nullable(),
  email: z.email().max(254).nullable(),
  website: orgWebsiteSchema.nullable(),
  openingHours: openingHoursSchema.nullable(),
  visibility: orgVisibilitySchema,
};

/**
 * PATCH-only: the active member buyers are pointed to for support (default: the oldest active owner).
 * `null` goes back to the default. Must be an active member of the organisation (else 400).
 */
const supportUserIdSchema = z.uuid().nullable();

/** POST /orgs. The creator becomes the active owner. */
export const createOrgRequestSchema = z.object({
  slug: orgSlugSchema,
  name: orgEditableFields.name,
  kind: orgEditableFields.kind,
  description: orgEditableFields.description.optional(),
  country: orgEditableFields.country.optional(),
  city: orgEditableFields.city.optional(),
  address: orgEditableFields.address.optional(),
  phone: orgEditableFields.phone.optional(),
  email: orgEditableFields.email.optional(),
  website: orgEditableFields.website.optional(),
  openingHours: orgEditableFields.openingHours.optional(),
  visibility: orgVisibilitySchema.default('public'),
});
export type CreateOrgRequest = z.infer<typeof createOrgRequestSchema>;

/** PATCH /orgs/:orgId. The slug is immutable in this lot (public URLs are shared). `null` clears a field. */
export const updateOrgRequestSchema = z
  .object({
    ...orgEditableFields,
    supportUserId: supportUserIdSchema,
    page: orgPageSchema,
    /** A ready `org_logo` / `org_banner` upload of the caller; `null` removes the image. */
    logoMediaId: z.uuid().nullable(),
    bannerMediaId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateOrgRequest = z.infer<typeof updateOrgRequestSchema>;

/** Full organisation, as seen by its members. */
export const orgSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: orgKindSchema,
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  openingHours: openingHoursSchema.nullable(),
  page: orgPageSchema,
  visibility: orgVisibilitySchema,
  status: orgStatusSchema,
  verificationStatus: orgVerificationStatusSchema,
  supportUserId: z.uuid().nullable(),
  createdBy: z.uuid().nullable(),
  /** Published position (members only; not part of PublicOrg). */
  location: z.object({ lat: z.number(), lng: z.number(), label: z.string().nullable() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Org = z.infer<typeof orgSchema>;

/** GET /public/orgs/:slug: the storefront. Public fields only (no status, creator or internal data). */
export const publicOrgSchema = orgSchema
  .pick({
    id: true,
    slug: true,
    name: true,
    kind: true,
    description: true,
    logoUrl: true,
    bannerUrl: true,
    country: true,
    city: true,
    address: true,
    phone: true,
    email: true,
    website: true,
    openingHours: true,
    page: true,
  })
  .extend({
    verified: z.boolean(),
    /** Member to open a direct conversation with; null when none, or blocked with the caller (token optional). */
    contactUserId: z.uuid().nullable(),
  });
export type PublicOrg = z.infer<typeof publicOrgSchema>;

export const orgSummarySchema = orgSchema.pick({
  id: true,
  slug: true,
  name: true,
  kind: true,
  logoUrl: true,
  visibility: true,
  status: true,
  verificationStatus: true,
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

/** One of the caller's memberships or pending invitations (GET /me/orgs). */
export const myOrgMembershipSchema = z.object({
  org: orgSummarySchema,
  role: orgRoleSchema,
  status: orgMemberStatusSchema,
  invitedBy: z.uuid().nullable(),
  /** Invitation (or creation) time. */
  createdAt: z.iso.datetime(),
  joinedAt: z.iso.datetime().nullable(),
});
export type MyOrgMembership = z.infer<typeof myOrgMembershipSchema>;
export const myOrgMembershipListSchema = z.object({ items: z.array(myOrgMembershipSchema) });

/** A member (or pending invitee) as seen by the organisation. */
export const orgMemberSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: orgRoleSchema,
  status: orgMemberStatusSchema,
  invitedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  joinedAt: z.iso.datetime().nullable(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

/** GET /orgs/:orgId/members: oldest first, cursor pagination; optional status filter. */
export const orgMemberListQuerySchema = pageQuerySchema.extend({
  status: orgMemberStatusSchema.optional(),
});
export type OrgMemberListQuery = z.infer<typeof orgMemberListQuerySchema>;
export const orgMemberListSchema = z.object({ items: z.array(orgMemberSchema), nextCursor: z.string().nullable() });
export type OrgMemberList = Page<OrgMember>;

/** POST /orgs/:orgId/invitations. Only owners may invite as owner or admin. */
export const inviteOrgMemberRequestSchema = z.object({ handle: handleSchema, role: orgRoleSchema });
export type InviteOrgMemberRequest = z.infer<typeof inviteOrgMemberRequestSchema>;

/** PATCH /orgs/:orgId/members/:userId. */
export const updateOrgMemberRequestSchema = z.object({ role: orgRoleSchema });
export type UpdateOrgMemberRequest = z.infer<typeof updateOrgMemberRequestSchema>;
