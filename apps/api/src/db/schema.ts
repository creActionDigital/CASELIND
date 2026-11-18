// Typed mirror of migrations/*.sql for Drizzle queries.
// The SQL migrations are the source of truth; keep this file in sync with them.
import {
  bigint,
  bigserial,
  boolean,
  char,
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userStatus = pgEnum('user_status', ['pending_verification', 'active', 'suspended', 'deleted']);
export const otpPurpose = pgEnum('otp_purpose', ['signup', 'password_reset', 'identifier_change']);
export const otpChannel = pgEnum('otp_channel', ['sms', 'email']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email'),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  handle: citext('handle').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  locale: text('locale').notNull().default('fr'),
  country: text('country'),
  status: userStatus('status').notNull().default('pending_verification'),
  roles: text('roles').array().notNull().default(['user']),
  emailVerifiedAt: tstz('email_verified_at'),
  phoneVerifiedAt: tstz('phone_verified_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  // Privacy settings (0003_privacy_blocks).
  discoverableByPhone: boolean('discoverable_by_phone').notNull().default(false),
  discoverableByEmail: boolean('discoverable_by_email').notNull().default(false),
  contactRequestsFrom: text('contact_requests_from')
    .$type<'everyone' | 'contacts_of_contacts' | 'nobody'>()
    .notNull()
    .default('everyone'),
  readReceipts: boolean('read_receipts').notNull().default(true),
  /** Set while an account deletion is pending (0004_account_deletion). */
  deletionRequestedAt: tstz('deletion_requested_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  deviceName: text('device_name'),
  platform: text('platform').notNull().default('other'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  lastUsedAt: tstz('last_used_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  revokedAt: tstz('revoked_at'),
  revokeReason: text('revoke_reason'),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  usedAt: tstz('used_at'),
});

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  purpose: otpPurpose('purpose').notNull(),
  channel: otpChannel('channel').notNull(),
  destination: text('destination').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  resendCount: integer('resend_count').notNull().default(0),
  lastSentAt: tstz('last_sent_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  consumedAt: tstz('consumed_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  occurredAt: tstz('occurred_at').notNull().defaultNow(),
  action: text('action').notNull(),
  actorUserId: uuid('actor_user_id'),
  subjectUserId: uuid('subject_user_id'),
  sessionId: uuid('session_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  regulated: boolean('regulated').notNull().default(false),
  /** NULL = every country. */
  allowedCountries: char('allowed_countries', { length: 2 }).array(),
  /** NULL = every role. */
  allowedRoles: text('allowed_roles').array(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/** blocker_id blocked blocked_id. Effect is symmetric: see PrivacyService.isBlockedEitherWay. */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;

/* Organisations (0005_organizations). Role/kind literal unions mirror @caselind/contracts. */

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: citext('slug').notNull(),
  name: text('name').notNull(),
  kind: text('kind')
    .$type<'shop' | 'restaurant' | 'hotel' | 'pharmacy' | 'fuel_station' | 'school' | 'hospital' | 'services' | 'warehouse' | 'other'>()
    .notNull(),
  description: text('description'),
  logoUrl: text('logo_url'),
  bannerUrl: text('banner_url'),
  country: char('country', { length: 2 }),
  city: text('city'),
  address: text('address'),
  phone: text('phone'),
  email: citext('email'),
  website: text('website'),
  /** Shape: OpeningHours (validated by the contract before it is stored). */
  openingHours: jsonb('opening_hours').$type<Record<string, { open: string; close: string }[] | undefined>>(),
  /** Mini-site content (0061); shape: OrgPage, validated by the contract before it is stored. */
  page: jsonb('page')
    .$type<{ links: { label: string; url: string }[]; serviceAreas: string[]; sections: { title: string; body: string }[]; faq: { question: string; answer: string }[] }>()
    .notNull()
    .default({ links: [], serviceAreas: [], sections: [], faq: [] }),
  visibility: text('visibility').$type<'public' | 'private'>().notNull().default('public'),
  status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
  verificationStatus: text('verification_status')
    .$type<'unverified' | 'pending' | 'verified'>()
    .notNull()
    .default('unverified'),
  /** Support contact chosen by the org (0015); null = oldest active owner. */
  supportUserId: uuid('support_user_id'),
  createdBy: uuid('created_by'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role')
      .$type<'owner' | 'admin' | 'manager' | 'finance' | 'stock' | 'sales' | 'hr' | 'support' | 'delivery' | 'employee'>()
      .notNull(),
    status: text('status').$type<'invited' | 'active'>().notNull(),
    invitedBy: uuid('invited_by'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    joinedAt: tstz('joined_at'),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type OrgMemberRow = typeof orgMembers.$inferSelect;

/** Uploaded files (0006_media). `mime` is detected from the content, never trusted from the client. */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  purpose: text('purpose')
    .$type<'avatar' | 'post' | 'message' | 'story' | 'org_logo' | 'org_banner' | 'product' | 'document' | 'kyc_document' | 'listing' | 'cv' | 'delivery' | 'lesson' | 'org_gallery'>()
    .notNull(),
  declaredMime: text('declared_mime').notNull(),
  mime: text('mime'),
  /** mode number: limits are far below 2^53. */
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  status: text('status').$type<'pending' | 'ready' | 'rejected'>().notNull().default('pending'),
  storageKey: text('storage_key').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  uploadedAt: tstz('uploaded_at'),
  rejectedReason: text('rejected_reason'),
});

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

// Lot 3, one file per module to avoid edits to this file by parallel work.
export * from './schema-messaging.js';
export * from './schema-notifications.js';
export * from './schema-social.js';
export * from './schema-stories.js';
export * from './schema-catalog.js';
export * from './schema-orders.js';
export * from './schema-ledger.js';
export * from './schema-kyc.js';
export * from './schema-messaging-extras.js';
export * from './schema-identity.js';
export * from './schema-delivery.js';
