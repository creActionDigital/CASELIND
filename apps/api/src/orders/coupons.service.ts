import { Inject, Injectable } from '@nestjs/common';
import {
  type Coupon,
  type CouponList,
  type CouponListQuery,
  type CouponRejectionReason,
  type CreateCouponRequest,
  ErrorCodes,
} from '@caselind/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { couponRedemptions, coupons, type CouponRow } from '../db/schema.js';
import { pgErrorOf, type Tx } from '../orgs/orgs.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from './orders.shared.js';

export interface CheckoutGroup {
  orgId: string;
  currency: string;
  subtotalMinor: number;
}

export interface AppliedCoupon {
  coupon: CouponRow;
  discountMinor: number;
}

function toCoupon(c: CouponRow): Coupon {
  return {
    id: c.id,
    orgId: c.orgId,
    code: c.code,
    kind: c.kind,
    value: c.value,
    currency: c.currency?.trim() ?? null,
    minOrderMinor: c.minOrderMinor,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    maxUses: c.maxUses,
    maxUsesPerUser: c.maxUsesPerUser,
    usesCount: c.usesCount,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
  };
}

export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

function rejected(reason: CouponRejectionReason, code: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'This coupon cannot be used', { reason, code });
}

export function discountFor(c: Pick<CouponRow, 'kind' | 'value'>, subtotalMinor: number): number {
  const raw = c.kind === 'percent' ? Math.floor((subtotalMinor * c.value) / 100) : c.value;
  return Math.min(raw, subtotalMinor);
}

@Injectable()
export class CouponsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async create(orgId: string, actorUserId: string, req: CreateCouponRequest, meta: RequestMeta): Promise<Coupon> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(coupons)
          .values({
            orgId,
            code: normalizeCouponCode(req.code),
            kind: req.kind,
            value: req.value,
            currency: req.kind === 'fixed' ? (req.currency ?? null) : null,
            minOrderMinor: req.minOrderMinor,
            startsAt: req.startsAt ? new Date(req.startsAt) : null,
            endsAt: req.endsAt ? new Date(req.endsAt) : null,
            maxUses: req.maxUses ?? null,
            maxUsesPerUser: req.maxUsesPerUser ?? null,
            createdBy: actorUserId,
          })
          .returning();
        await this.audit.record(
          { action: 'commerce.coupon_created', actorUserId, meta, metadata: { orgId, couponId: row!.id, code: row!.code } },
          tx,
        );
        return toCoupon(row!);
      });
    } catch (err) {
      if (pgErrorOf(err).constraint === 'coupons_org_code_unique') {
        throw AppError.conflict('This coupon code already exists', { reason: 'code_taken' });
      }
      throw err;
    }
  }

  async list(orgId: string, q: CouponListQuery): Promise<CouponList> {
    const filters = [eq(coupons.orgId, orgId)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${coupons.createdAt}, ${coupons.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: coupons, exact: sql<string>`${coupons.createdAt}::text` })
      .from(coupons)
      .where(and(...filters))
      .orderBy(desc(coupons.createdAt), desc(coupons.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toCoupon(r.row)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }

  /** Deactivation only; a coupon already used keeps its redemptions. Idempotent. */
  async deactivate(orgId: string, couponId: string, actorUserId: string, meta: RequestMeta): Promise<Coupon> {
    if (!UUID_RE.test(couponId)) throw AppError.notFound('Coupon not found');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(coupons)
        .set({ active: false })
        .where(and(eq(coupons.id, couponId), eq(coupons.orgId, orgId)))
        .returning();
      if (!row) throw AppError.notFound('Coupon not found');
      await this.audit.record(
        { action: 'commerce.coupon_deactivated', actorUserId, meta, metadata: { orgId, couponId, code: row.code } },
        tx,
      );
      return toCoupon(row);
    });
  }

  /**
   * Inside the checkout transaction: locks the coupons named by `codes` (id order) and validates them
   * against the order groups. A code applies to the order of the organisation that issued it; one coupon
   * per order at most. Returns the coupon applied to each group (key `orgId|currency`).
   * 400 `details {reason, code}`: expired | exhausted | min_not_reached | not_applicable.
   */
  async resolve(tx: Tx, userId: string, codes: string[], groups: CheckoutGroup[], now = new Date()): Promise<Map<string, AppliedCoupon>> {
    const applied = new Map<string, AppliedCoupon>();
    const normalized = [...new Set(codes.map(normalizeCouponCode))];
    if (normalized.length === 0) return applied;

    const orgIds = [...new Set(groups.map((g) => g.orgId))];
    const found = await tx
      .select()
      .from(coupons)
      .where(and(inArray(coupons.code, normalized), inArray(coupons.orgId, orgIds)))
      .orderBy(coupons.id)
      .for('update');

    for (const code of normalized) {
      const matches = found.filter((c) => c.code === code);
      if (matches.length === 0) throw rejected('not_applicable', code);
      for (const c of matches) {
        const group = groups.find((g) => g.orgId === c.orgId && (c.kind === 'percent' || g.currency === c.currency?.trim()));
        if (!c.active || !group) throw rejected('not_applicable', code);
        const key = `${group.orgId}|${group.currency}`;
        if (applied.has(key)) throw rejected('not_applicable', code);
        if ((c.startsAt && c.startsAt > now) || (c.endsAt && c.endsAt <= now)) throw rejected('expired', code);
        if (c.maxUses !== null && c.usesCount >= c.maxUses) throw rejected('exhausted', code);
        if (c.maxUsesPerUser !== null) {
          const [used] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(couponRedemptions)
            .where(and(eq(couponRedemptions.couponId, c.id), eq(couponRedemptions.userId, userId), isNull(couponRedemptions.releasedAt)));
          if ((used?.n ?? 0) >= c.maxUsesPerUser) throw rejected('exhausted', code);
        }
        if (group.subtotalMinor < c.minOrderMinor) throw rejected('min_not_reached', code);
        applied.set(key, { coupon: c, discountMinor: discountFor(c, group.subtotalMinor) });
      }
    }
    return applied;
  }

  /** Inside the checkout transaction, once the order exists. */
  async redeem(tx: Tx, couponId: string, orderId: string, userId: string): Promise<void> {
    await tx.insert(couponRedemptions).values({ couponId, orderId, userId });
    await tx
      .update(coupons)
      .set({ usesCount: sql`${coupons.usesCount} + 1` })
      .where(eq(coupons.id, couponId));
  }

  /** Inside the cancellation transaction: gives the use back (idempotent). */
  async release(tx: Tx, orderId: string): Promise<void> {
    const [r] = await tx
      .update(couponRedemptions)
      .set({ releasedAt: new Date() })
      .where(and(eq(couponRedemptions.orderId, orderId), isNull(couponRedemptions.releasedAt)))
      .returning({ couponId: couponRedemptions.couponId });
    if (r) {
      await tx
        .update(coupons)
        .set({ usesCount: sql`greatest(${coupons.usesCount} - 1, 0)` })
        .where(eq(coupons.id, r.couponId));
    }
  }
}
