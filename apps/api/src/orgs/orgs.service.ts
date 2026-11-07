import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateOrgRequest,
  ErrorCodes,
  type MyOrgMembership,
  type OpeningHours,
  type Org,
  type OrgSummary,
  type PublicOrg,
  type UpdateOrgRequest,
} from '@caselind/contracts';
import { and, count, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { type OrganizationRow, organizations, orgMembers, type OrgMemberRow, users } from '../db/schema.js';
import { orgNotFound } from './org.guard.js';
import { resolveContactUserId } from './org-contact.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A user may be an active owner of at most this many organisations (anti-squatting of slugs). */
export const MAX_OWNED_ORGS = 10;

/** Same pattern as the contract: anything else cannot be a slug, so it is a plain 404. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/i;

/** Postgres error carried by a Drizzle query error (or the raw pg error). */
export function pgErrorOf(err: unknown): { code?: string; constraint?: string } {
  return ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
}

/** Fields that identify the business: changing one invalidates a granted or pending verification. */
const VERIFICATION_SENSITIVE_FIELDS = ['name', 'kind', 'website', 'phone', 'email'] as const;

/** E-mail is citext in the database: a case-only change is not a change. */
function sameValue(field: (typeof VERIFICATION_SENSITIVE_FIELDS)[number], a: string | null, b: string | null): boolean {
  if (field === 'email' && a !== null && b !== null) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function toOrg(o: OrganizationRow): Org {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    kind: o.kind,
    description: o.description,
    logoUrl: o.logoUrl,
    bannerUrl: o.bannerUrl,
    country: o.country,
    city: o.city,
    address: o.address,
    phone: o.phone,
    email: o.email,
    website: o.website,
    openingHours: o.openingHours as OpeningHours | null,
    visibility: o.visibility,
    status: o.status,
    verificationStatus: o.verificationStatus,
    supportUserId: o.supportUserId,
    createdBy: o.createdBy,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toOrgSummary(o: OrganizationRow): OrgSummary {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    kind: o.kind,
    logoUrl: o.logoUrl,
    visibility: o.visibility,
    status: o.status,
    verificationStatus: o.verificationStatus,
  };
}

export function toMyMembership(o: OrganizationRow, m: OrgMemberRow): MyOrgMembership {
  return {
    org: toOrgSummary(o),
    role: m.role,
    status: m.status,
    invitedBy: m.invitedBy,
    createdAt: m.createdAt.toISOString(),
    joinedAt: m.joinedAt?.toISOString() ?? null,
  };
}

/**
 * Refuses (409) when `userId` already owns MAX_OWNED_ORGS organisations. Locks the user row so two
 * concurrent creations/acceptances by the same user cannot both pass the count.
 *
 * FOR NO KEY UPDATE, not FOR UPDATE: it still conflicts with itself (serialising the quota check)
 * but not with the FOR KEY SHARE that every insert referencing users(id) takes (sessions, audit
 * events, memberships...), so it does not stall unrelated writes. Lock order: callers that lock an
 * organizations row do it BEFORE this user lock (org -> user), like AccountService.requestDeletion
 * and the deletion purge.
 */
export async function assertOwnerQuota(tx: Tx, userId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
  const [row] = await tx
    .select({ n: count() })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, 'owner'), eq(orgMembers.status, 'active')));
  if ((row?.n ?? 0) >= MAX_OWNED_ORGS) {
    throw AppError.conflict(`A user can own at most ${MAX_OWNED_ORGS} organizations`, {
      reason: 'owner_limit',
      limit: MAX_OWNED_ORGS,
    });
  }
}

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** The creator becomes the active owner, in the same transaction as the org row. */
  async create(userId: string, req: CreateOrgRequest, meta: RequestMeta): Promise<Org> {
    try {
      return await this.db.transaction(async (tx) => {
        await assertOwnerQuota(tx, userId);
        const [org] = await tx
          .insert(organizations)
          .values({ ...req, createdBy: userId })
          .returning();
        await tx.insert(orgMembers).values({
          orgId: org!.id,
          userId,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        });
        await this.audit.record(
          { action: 'org.created', actorUserId: userId, meta, metadata: { orgId: org!.id, slug: org!.slug, kind: org!.kind } },
          tx,
        );
        return toOrg(org!);
      });
    } catch (err) {
      const pgErr = pgErrorOf(err);
      if (pgErr.code === '23505' && pgErr.constraint === 'organizations_slug_key') {
        throw AppError.conflict('This slug is already taken', { field: 'slug' });
      }
      throw err;
    }
  }

  /** Membership is checked by OrgGuard before this runs. */
  async get(orgId: string): Promise<Org> {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) throw orgNotFound();
    return toOrg(org);
  }

  /**
   * A change to an identity field (VERIFICATION_SENSITIVE_FIELDS) of a verified or pending org resets
   * its verification to 'unverified' in the same UPDATE, so a verified badge never carries over to a
   * different business; the reset is recorded in the audit metadata. The row is locked first so the
   * comparison and the write see the same values.
   */
  async update(orgId: string, actorUserId: string, patch: UpdateOrgRequest, meta: RequestMeta): Promise<Org> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for('update');
      if (!current) throw orgNotFound();
      if (patch.supportUserId) {
        const [member] = await tx
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, patch.supportUserId), eq(orgMembers.status, 'active')))
          .limit(1);
        if (!member) {
          throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
            { path: 'supportUserId', message: 'must be an active member of the organization' },
          ]);
        }
      }
      const changed = VERIFICATION_SENSITIVE_FIELDS.filter(
        (f) => f in patch && patch[f] !== undefined && !sameValue(f, patch[f] ?? null, current[f] ?? null),
      );
      const resetVerification = changed.length > 0 && current.verificationStatus !== 'unverified';
      const [org] = await tx
        .update(organizations)
        .set(resetVerification ? { ...patch, verificationStatus: 'unverified' } : patch)
        .where(eq(organizations.id, orgId))
        .returning();
      if (!org) throw orgNotFound();
      await this.audit.record(
        {
          action: 'org.updated',
          actorUserId,
          meta,
          metadata: {
            orgId,
            fields: Object.keys(patch),
            ...(resetVerification
              ? { verificationReset: { from: current.verificationStatus, to: 'unverified', fields: changed } }
              : {}),
          },
        },
        tx,
      );
      return toOrg(org);
    });
  }

  /**
   * Storefront (CDC §5): readable without a token. Only public AND active orgs; anything else
   * (private, suspended, unknown, malformed slug) is the same 404. Public fields only.
   */
  async publicBySlug(slug: string, viewerId: string | null = null): Promise<PublicOrg> {
    if (!SLUG_RE.test(slug)) throw orgNotFound();
    const [o] = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.slug, slug), eq(organizations.visibility, 'public'), eq(organizations.status, 'active')))
      .limit(1);
    if (!o) throw orgNotFound();
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      kind: o.kind,
      description: o.description,
      logoUrl: o.logoUrl,
      bannerUrl: o.bannerUrl,
      country: o.country,
      city: o.city,
      address: o.address,
      phone: o.phone,
      email: o.email,
      website: o.website,
      openingHours: o.openingHours as OpeningHours | null,
      verified: o.verificationStatus === 'verified',
      contactUserId: await resolveContactUserId(this.db, o.id, viewerId),
    };
  }

  /**
   * The caller's memberships and pending invitations, newest first. Not paginated: bounded by
   * the owner quota plus what other orgs invite the user to (capped at 500 rows here).
   */
  async myOrgs(userId: string): Promise<{ items: MyOrgMembership[] }> {
    const rows = await this.db
      .select({ o: organizations, m: orgMembers })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId))
      .orderBy(desc(orgMembers.createdAt), desc(orgMembers.orgId))
      .limit(500);
    return { items: rows.map((r) => toMyMembership(r.o, r.m)) };
  }
}
