import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  COURIER_REQUEST_MAX_KM,
  COURIER_REQUEST_OPEN_MAX,
  COURIER_REQUEST_TTL_MINUTES,
  type CourierOfferList,
  type CourierOffersQuery,
  type CourierRequest,
  type CourierRequestEstimate,
  type CourierRequestEstimateRequest,
  type CourierRequestList,
  type CourierRequestListQuery,
  type CourierRequestStatus,
  type CourierRoutePlan,
  type CourierRoutePlanQuery,
  type CreateCourierRequest,
  DELIVERY_SCHEDULE_VISIBLE_MINUTES,
  ErrorCodes,
  type MyCourierJobs,
  type MyCourierJobsQuery,
  PROOF_MAX_ATTEMPTS,
} from '@caselind/contracts';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { type CourierRequestRow, courierRequests, deliveries, orders, users } from '../db/schema.js';
import { checkedSchedule, decodeCursor, DeliveryCodes, encodeCursor, proofLocked, UUID_RE, wrongProofCode } from '../delivery/delivery.shared.js';
import { HAVERSINE_SQL, haversineKm } from '../mobility/mobility.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Tx } from '../orgs/orgs.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { KycPort } from '../wallet/kyc.port.js';
import { estimateCourierFee, MIN_TRIP_KM, roundCoord } from './courier-requests.shared.js';
import { type PlanNode, planRoute } from './route-plan.logic.js';

const NOTE = 'Tarif estimé à partir de la distance à vol d’oiseau : il peut varier. Paiement en espèces au coursier. Aucune disponibilité n’est garantie.';
/** Escalating lock: 1st series of wrong codes 10 min, 2nd 30 min, 3rd: locked until the requester resets the code. */
const PROOF_LOCK_MINUTES = [10, 30];
const NEVER = new Date('9999-12-31T00:00:00.000Z');
const ACCEPTS_PER_MINUTE = 5;
/** A courier carries at most this many requests at once. */
const COURIER_ACTIVE_MAX = 3;
const LIVE: CourierRequestStatus[] = ['requested', 'accepted', 'picked_up'];

const notFound = () => AppError.notFound('Courier request not found');
const validation = (path: string, message: string, reason: string) =>
  new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message, reason }]);
const forbiddenBecause = (message: string, reason: string) => new AppError(403, ErrorCodes.forbidden, message, { reason });

/** Requested but past its deadline: shown as expired before the maintenance job writes it. */
const effectiveStatus = (r: CourierRequestRow, now: Date): CourierRequestStatus =>
  r.status === 'requested' && r.expiresAt.getTime() <= now.getTime() ? 'expired' : r.status;

/** Raw timestamps come back as text from `execute`. */
const asDate = (v: Date | string): Date => new Date(v);
const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);

/** A point without its exact address: coordinates to ~100 m, no label. */
const blurred = (lat: number, lng: number) => ({ lat: roundCoord(lat), lng: roundCoord(lng), label: '' });

interface Party {
  id: string;
  handle: string;
  displayName: string;
}

@Injectable()
export class CourierRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly codes: DeliveryCodes,
    private readonly kyc: KycPort,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** shortcut: in-memory per instance (like the impression batches brake); move to the throttler store when scaling out. */
  private readonly acceptHits = new Map<string, number[]>();

  private brakeAccept(courierId: string): void {
    const now = Date.now();
    const hits = (this.acceptHits.get(courierId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= ACCEPTS_PER_MINUTE) {
      this.acceptHits.set(courierId, hits);
      throw new AppError(429, ErrorCodes.rateLimited, 'Too many acceptances, try again in a minute');
    }
    hits.push(now);
    this.acceptHits.set(courierId, hits);
  }

  /* ------------------------------------------------------------------ requester side */

  private quote(body: CourierRequestEstimateRequest) {
    const currency = body.currency ?? 'USD';
    const q = estimateCourierFee(this.env.MOBILITY_TARIFFS, currency, body.pickup, body.dropoff, body.size ?? null, this.env.MOBILITY_DETOUR_FACTOR);
    if (!q) throw validation('currency', 'no tariff for this currency', 'currency_unsupported');
    if (q.distanceKm > COURIER_REQUEST_MAX_KM) throw validation('dropoff', `the trip is limited to ${COURIER_REQUEST_MAX_KM} km`, 'too_far');
    if (haversineKm(body.pickup, body.dropoff) < MIN_TRIP_KM) throw validation('dropoff', 'pick-up and drop-off are the same place', 'same_point');
    return { currency, ...q };
  }

  estimate(body: CourierRequestEstimateRequest): CourierRequestEstimate {
    const q = this.quote(body);
    return { estimated: true, currency: q.currency, distanceKm: q.distanceKm, durationMin: q.durationMin, feeMinor: q.feeMinor, paymentMode: 'cash', note: NOTE };
  }

  async create(userId: string, body: CreateCourierRequest, meta: RequestMeta): Promise<CourierRequest> {
    const q = this.quote(body);
    const now = new Date();
    const scheduledFor = checkedSchedule(body.scheduledFor, now);
    const id = randomUUID();
    const proof = this.codes.issue(id);
    const expiresAt = new Date((scheduledFor ?? now).getTime() + COURIER_REQUEST_TTL_MINUTES * 60_000);
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'courier-req:' + userId}))`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(courierRequests)
        .where(
          and(
            eq(courierRequests.requesterId, userId),
            or(inArray(courierRequests.status, ['accepted', 'picked_up']), and(eq(courierRequests.status, 'requested'), sql`${courierRequests.expiresAt} > now()`)),
          ),
        );
      if (n >= COURIER_REQUEST_OPEN_MAX) throw AppError.conflict('Too many open courier requests', { reason: 'open_limit', max: COURIER_REQUEST_OPEN_MAX });
      const [r] = await tx
        .insert(courierRequests)
        .values({
          id,
          requesterId: userId,
          kind: body.kind,
          size: body.size ?? null,
          pickupLat: body.pickup.lat,
          pickupLng: body.pickup.lng,
          pickupLabel: body.pickup.label,
          dropoffLat: body.dropoff.lat,
          dropoffLng: body.dropoff.lng,
          dropoffLabel: body.dropoff.label,
          note: body.note ?? null,
          currency: q.currency,
          feeEstimateMinor: q.feeMinor,
          distanceKm: q.distanceKm,
          proofNonce: proof.nonce,
          proofHash: proof.hash,
          scheduledFor,
          expiresAt,
        })
        .returning();
      await this.audit.record(
        {
          action: 'courier_request.created',
          actorUserId: userId,
          meta,
          metadata: { requestId: id, kind: body.kind, currency: q.currency, feeMinor: q.feeMinor, scheduled: scheduledFor !== null },
        },
        tx,
      );
      return r!;
    });
    return (await this.views([row], userId))[0]!;
  }

  async list(userId: string, q: CourierRequestListQuery): Promise<CourierRequestList> {
    const filters: SQL[] = [eq(courierRequests.requesterId, userId)];
    const live = sql`(${courierRequests.status} IN ('accepted', 'picked_up') OR (${courierRequests.status} = 'requested' AND ${courierRequests.expiresAt} > now()))`;
    if (q.scope === 'active') filters.push(live);
    if (q.scope === 'done') filters.push(sql`NOT ${live}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${courierRequests.createdAt}, ${courierRequests.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const found = await this.db
      .select({ row: courierRequests, exact: sql<string>`${courierRequests.createdAt}::text` })
      .from(courierRequests)
      .where(and(...filters))
      .orderBy(desc(courierRequests.createdAt), desc(courierRequests.id))
      .limit(q.limit + 1);
    const page = found.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.views(page.map((p) => p.row), userId),
      nextCursor: found.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }

  /** A party only: the requester, or the courier once the request is accepted. Anyone else: 404. */
  async get(userId: string, id: string): Promise<CourierRequest> {
    return (await this.views([await this.ofParty(this.db, userId, id)], userId))[0]!;
  }

  async cancel(userId: string, id: string, meta: RequestMeta): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const done = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(courierRequests).where(and(eq(courierRequests.id, id), eq(courierRequests.requesterId, userId))).for('update').limit(1);
      if (!r) throw notFound();
      if (r.status === 'cancelled') return { row: r, changed: false as const };
      if (r.status !== 'requested' && r.status !== 'accepted') throw AppError.conflict('This request can no longer be cancelled', { reason: 'invalid_transition', from: r.status, to: 'cancelled' });
      const [u] = await tx
        .update(courierRequests)
        .set({ status: 'cancelled', cancelledAt: new Date(), lastLat: null, lastLng: null, lastLocationAt: null, locationConsent: false })
        .where(eq(courierRequests.id, id))
        .returning();
      await this.audit.record(
        { action: 'courier_request.status_changed', actorUserId: userId, meta, metadata: { requestId: id, from: r.status, to: 'cancelled' } },
        tx,
      );
      return { row: u!, changed: true as const, courierId: r.courierId };
    });
    if (done.changed && done.courierId) await this.tell(done.courierId, done.row, 'Une demande de coursier que vous aviez acceptée a été annulée.');
    return (await this.views([done.row], userId))[0]!;
  }

  /** Reciprocal and simple: each party rates the other once, when the request is delivered. */
  async rate(userId: string, id: string, rating: number): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = await this.db.transaction(async (tx) => {
      const r = await this.ofParty(tx, userId, id, true);
      if (r.status !== 'delivered') throw AppError.conflict('Only a delivered request can be rated', { reason: 'not_delivered' });
      const asRequester = r.requesterId === userId;
      if ((asRequester ? r.requesterRating : r.courierRating) !== null) throw AppError.conflict('You already rated this request', { reason: 'already_rated' });
      const [u] = await tx
        .update(courierRequests)
        .set(asRequester ? { requesterRating: rating } : { courierRating: rating })
        .where(eq(courierRequests.id, id))
        .returning();
      return u!;
    });
    const other = row.requesterId === userId ? row.courierId : row.requesterId;
    if (other) await this.tell(other, row, `Vous avez reçu une évaluation : ${rating}/5.`);
    return (await this.views([row], userId))[0]!;
  }

  /* ------------------------------------------------------------------ courier side */

  /** An approved mobility driver with KYC level 1: the closest existing profile to an independent courier. */
  private async requireCourier(exec: Pick<Db, 'execute'>, userId: string): Promise<void> {
    const found = await exec.execute(sql`SELECT 1 FROM mobility_drivers WHERE user_id = ${userId}::uuid AND status = 'approved'`);
    if (found.rows.length === 0) throw forbiddenBecause('Register as a driver and get approved first', 'courier_not_registered');
    if ((await this.kyc.limitsFor(userId, 'USD')).tier < 1) throw forbiddenBecause('Identity verification (level 1) is required', 'kyc_required');
  }

  /**
   * Open requests around a position, nearest pick-up first. Coordinates are rounded to 3 decimals and the distance
   * is measured on the rounded point (a courier moving the query point cannot triangulate the exact address);
   * no label, no note, no requester before acceptance.
   */
  async offers(courierId: string, q: CourierOffersQuery): Promise<CourierOfferList> {
    await this.requireCourier(this.db, courierId);
    const radius = q.radiusKm ?? this.env.MOBILITY_PICKUP_RADIUS_KM;
    const plat = 'round(r.pickup_lat::numeric, 3)::float8';
    const plng = 'round(r.pickup_lng::numeric, 3)::float8';
    const dist = sql.raw(HAVERSINE_SQL(String(q.lat), String(q.lng), plat, plng));
    const res = await this.db.execute(sql`
      SELECT * FROM (
        SELECT r.id, r.kind, r.size, r.currency, r.fee_estimate_minor, r.distance_km, r.scheduled_for, r.expires_at, r.created_at,
               ${sql.raw(plat)} AS plat, ${sql.raw(plng)} AS plng,
               round(r.dropoff_lat::numeric, 3)::float8 AS dlat, round(r.dropoff_lng::numeric, 3)::float8 AS dlng,
               ${dist} AS pd
        FROM courier_requests r
        WHERE r.status = 'requested' AND r.expires_at > now() AND r.requester_id <> ${courierId}::uuid
          AND (r.scheduled_for IS NULL OR r.scheduled_for <= now() + make_interval(mins => ${DELIVERY_SCHEDULE_VISIBLE_MINUTES}))
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = r.requester_id AND b.blocked_id = ${courierId}::uuid)
                                                          OR (b.blocker_id = ${courierId}::uuid AND b.blocked_id = r.requester_id))
      ) x WHERE pd <= ${radius} ORDER BY pd, created_at, id LIMIT 20`);
    type R = {
      id: string; kind: 'parcel' | 'document'; size: 'small' | 'medium' | 'large' | null; currency: string; fee_estimate_minor: string | number;
      distance_km: number; scheduled_for: Date | string | null; expires_at: Date | string; created_at: Date | string;
      plat: number; plng: number; dlat: number; dlng: number; pd: number;
    };
    return {
      items: (res.rows as unknown as R[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        size: r.size,
        pickup: { lat: r.plat, lng: r.plng },
        dropoff: { lat: r.dlat, lng: r.dlng },
        pickupDistanceKm: Math.round(r.pd * 100) / 100,
        tripKm: r.distance_km,
        currency: r.currency.trim(),
        feeMinor: Number(r.fee_estimate_minor),
        scheduledFor: r.scheduled_for ? asDate(r.scheduled_for).toISOString() : null,
        expiresAt: asDate(r.expires_at).toISOString(),
        createdAt: asDate(r.created_at).toISOString(),
      })),
    };
  }

  /** First come, first served: the second courier waits on the row lock and then sees it taken (409). */
  async accept(courierId: string, id: string, meta: RequestMeta): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    await this.requireCourier(this.db, courierId);
    this.brakeAccept(courierId);
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(courierRequests).where(eq(courierRequests.id, id)).for('update').limit(1);
      if (!r) throw notFound();
      if (r.requesterId === courierId) throw forbiddenBecause('You cannot accept your own request', 'own_request');
      const blocked = await tx.execute(sql`
        SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${r.requesterId}::uuid AND b.blocked_id = ${courierId}::uuid)
                                       OR (b.blocker_id = ${courierId}::uuid AND b.blocked_id = ${r.requesterId}::uuid) LIMIT 1`);
      if (blocked.rows.length > 0) throw notFound();
      if (effectiveStatus(r, new Date()) !== 'requested') throw AppError.conflict('This request is no longer available', { reason: 'request_unavailable' });
      if (r.scheduledFor && r.scheduledFor.getTime() - DELIVERY_SCHEDULE_VISIBLE_MINUTES * 60_000 > Date.now()) {
        throw AppError.conflict('This scheduled request is not open yet', { reason: 'not_open_yet' });
      }
      // Two parallel acceptances by the same courier must not both pass the active-requests count.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`courier-active:${courierId}`}, 0))`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(courierRequests)
        .where(and(eq(courierRequests.courierId, courierId), inArray(courierRequests.status, ['accepted', 'picked_up'])));
      if (n >= COURIER_ACTIVE_MAX) throw AppError.conflict('You already carry too many requests', { reason: 'courier_busy', max: COURIER_ACTIVE_MAX });
      const [u] = await tx
        .update(courierRequests)
        .set({ status: 'accepted', courierId, acceptedAt: new Date() })
        .where(eq(courierRequests.id, id))
        .returning();
      await this.audit.record(
        { action: 'courier_request.status_changed', actorUserId: courierId, subjectUserId: r.requesterId, meta, metadata: { requestId: id, from: 'requested', to: 'accepted', courierUserId: courierId } },
        tx,
      );
      return u!;
    });
    await this.tell(row.requesterId, row, 'Un coursier a accepté votre demande.');
    return (await this.views([row], courierId))[0]!;
  }

  async pickedUp(courierId: string, id: string, meta: RequestMeta): Promise<CourierRequest> {
    const row = await this.step(courierId, id, 'accepted', 'picked_up', { pickedUpAt: new Date() }, meta);
    await this.tell(row.requesterId, row, 'Le coursier a récupéré votre envoi.');
    return (await this.views([row], courierId))[0]!;
  }

  /** The requester's 6-digit code (5 attempts, then locked for 10 minutes). */
  async delivered(courierId: string, id: string, code: string, meta: RequestMeta): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const out = await this.db.transaction(async (tx) => {
      const r = await this.lockOfCourier(tx, courierId, id);
      if (r.status !== 'picked_up') throw AppError.conflict(`A request ${r.status} cannot become delivered`, { reason: 'invalid_transition', from: r.status, to: 'delivered' });
      if (r.proofLockedUntil && r.proofLockedUntil.getTime() > Date.now()) return { kind: 'locked' as const };
      if (!this.codes.matches(r.id, code, r.proofHash)) {
        const attempts = r.proofAttempts + 1;
        const locked = attempts >= PROOF_MAX_ATTEMPTS;
        const minutes = PROOF_LOCK_MINUTES[r.proofLockRounds];
        await tx
          .update(courierRequests)
          .set({
            proofAttempts: locked ? 0 : attempts,
            proofLockRounds: locked ? r.proofLockRounds + 1 : r.proofLockRounds,
            proofLockedUntil: locked ? (minutes ? new Date(Date.now() + minutes * 60_000) : NEVER) : null,
          })
          .where(eq(courierRequests.id, r.id));
        return { kind: 'bad_code' as const, remaining: Math.max(0, PROOF_MAX_ATTEMPTS - attempts), locked };
      }
      const [u] = await tx
        .update(courierRequests)
        .set({ status: 'delivered', deliveredAt: new Date(), lastLat: null, lastLng: null, lastLocationAt: null, locationConsent: false, proofAttempts: 0 })
        .where(eq(courierRequests.id, r.id))
        .returning();
      await this.audit.record(
        { action: 'courier_request.status_changed', actorUserId: courierId, subjectUserId: r.requesterId, meta, metadata: { requestId: r.id, from: 'picked_up', to: 'delivered', courierUserId: courierId } },
        tx,
      );
      return { kind: 'ok' as const, row: u! };
    });
    if (out.kind === 'locked' || (out.kind === 'bad_code' && out.locked)) throw proofLocked();
    if (out.kind === 'bad_code') throw wrongProofCode(out.remaining);
    await this.tell(out.row.requesterId, out.row, 'Votre envoi est livré. Vous pouvez évaluer le coursier.');
    return (await this.views([out.row], courierId))[0]!;
  }

  /** The requester unlocks a code locked for good (3 series of wrong codes): a new code, attempts and rounds back to zero. */
  async resetProof(userId: string, id: string, meta: RequestMeta): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(courierRequests).where(and(eq(courierRequests.id, id), eq(courierRequests.requesterId, userId))).for('update').limit(1);
      if (!r) throw notFound();
      if (r.status !== 'picked_up') throw AppError.conflict('Only a request being delivered has a code to reset', { reason: 'invalid_transition', from: r.status, to: r.status });
      const proof = this.codes.issue(r.id);
      const [u] = await tx
        .update(courierRequests)
        .set({ proofNonce: proof.nonce, proofHash: proof.hash, proofAttempts: 0, proofLockRounds: 0, proofLockedUntil: null })
        .where(eq(courierRequests.id, id))
        .returning();
      await this.audit.record({ action: 'courier_request.proof_reset', actorUserId: userId, subjectUserId: r.courierId, meta, metadata: { requestId: id } }, tx);
      return u!;
    });
    return (await this.views([row], userId))[0]!;
  }

  async myJobs(courierId: string, q: MyCourierJobsQuery): Promise<MyCourierJobs> {
    const rows = await this.db
      .select()
      .from(courierRequests)
      .where(
        and(
          eq(courierRequests.courierId, courierId),
          q.scope === 'active' ? inArray(courierRequests.status, ['accepted', 'picked_up']) : inArray(courierRequests.status, ['delivered', 'cancelled']),
        ),
      )
      .orderBy(desc(courierRequests.createdAt), desc(courierRequests.id))
      .limit(q.limit);
    return { items: await this.views(rows, courierId) };
  }

  /** The courier agrees (or stops agreeing) to share their position with the requester; withdrawing erases the last point. */
  async setLocationConsent(courierId: string, id: string, granted: boolean): Promise<CourierRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = await this.db.transaction(async (tx) => {
      const r = await this.lockOfCourier(tx, courierId, id);
      if (r.status !== 'accepted' && r.status !== 'picked_up') throw AppError.conflict('The request is not under way', { reason: 'invalid_transition', from: r.status, to: r.status });
      const [u] = await tx
        .update(courierRequests)
        .set(granted ? { locationConsent: true } : { locationConsent: false, lastLat: null, lastLng: null, lastLocationAt: null })
        .where(eq(courierRequests.id, id))
        .returning();
      return u!;
    });
    return (await this.views([row], courierId))[0]!;
  }

  /** Last known position, picked up only, with consent; no history; pushed to the requester. */
  async postLocation(courierId: string, id: string, lat: number, lng: number): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound();
    const now = new Date();
    const [row] = await this.db
      .update(courierRequests)
      .set({ lastLat: lat, lastLng: lng, lastLocationAt: now })
      .where(and(eq(courierRequests.id, id), eq(courierRequests.courierId, courierId), eq(courierRequests.status, 'picked_up'), eq(courierRequests.locationConsent, true)))
      .returning();
    if (!row) {
      const r = await this.ofParty(this.db, courierId, id);
      if (r.courierId !== courierId) throw notFound();
      if (r.status !== 'picked_up') throw AppError.conflict('The request is not picked up', { reason: 'not_in_transit' });
      throw forbiddenBecause('Location sharing was not accepted by the courier', 'location_consent_required');
    }
    // Reuses the delivery push events: the payload carries courierRequestId instead of an order.
    this.realtime.emitToUser(row.requesterId, 'delivery.location', { courierRequestId: row.id, lat, lng, updatedAt: now.toISOString() });
  }

  /** Nearest-neighbour order of the courier's own accepted requests and assigned deliveries. */
  async routePlan(courierId: string, q: CourierRoutePlanQuery): Promise<CourierRoutePlan> {
    const ids = [...new Set(q.ids)];
    const [reqs, dels] = await Promise.all([
      this.db.select().from(courierRequests).where(and(inArray(courierRequests.id, ids), eq(courierRequests.courierId, courierId))),
      this.db
        .select({ d: deliveries, number: orders.number })
        .from(deliveries)
        .innerJoin(orders, eq(orders.id, deliveries.orderId))
        .where(and(inArray(deliveries.id, ids), eq(deliveries.courierId, courierId))),
    ]);
    // Anything that is not the caller's own: 404, like everywhere else.
    if (reqs.length + dels.length !== ids.length) throw notFound();
    const nodes: PlanNode[] = [];
    for (const r of reqs) {
      if (r.status !== 'accepted' && r.status !== 'picked_up') continue;
      const due = iso(r.scheduledFor);
      if (r.status === 'accepted') {
        nodes.push({ type: 'courier_request', id: r.id, step: 'pickup', label: r.pickupLabel, lat: r.pickupLat, lng: r.pickupLng, express: false, due });
      }
      // The exact drop-off is not handed to the courier before the pick-up: until then the plan uses the rounded point.
      const drop = r.status === 'accepted' ? blurred(r.dropoffLat, r.dropoffLng) : { lat: r.dropoffLat, lng: r.dropoffLng, label: r.dropoffLabel };
      nodes.push({
        type: 'courier_request', id: r.id, step: 'dropoff', label: drop.label || 'Dépose', lat: drop.lat, lng: drop.lng, express: false, due,
        ...(r.status === 'accepted' ? { after: `${r.id}:pickup` } : {}),
      });
    }
    for (const { d, number } of dels) {
      if (d.status !== 'assigned' && d.status !== 'picked_up' && d.status !== 'in_transit') continue;
      // The order address is text without coordinates: such a stop goes after the located ones.
      nodes.push({ type: 'delivery', id: d.id, step: 'delivery', label: number, lat: null, lng: null, express: d.speed === 'express', due: iso(d.scheduledFor) });
    }
    return planRoute({ lat: q.lat, lng: q.lng }, nodes, this.env.MOBILITY_DETOUR_FACTOR);
  }

  /* ------------------------------------------------------------------ internals */

  /** Moves a request the courier carries from one status to the next, inside one transaction. */
  private async step(
    courierId: string,
    id: string,
    from: CourierRequestStatus,
    to: CourierRequestStatus,
    set: Partial<typeof courierRequests.$inferInsert>,
    meta: RequestMeta,
  ): Promise<CourierRequestRow> {
    if (!UUID_RE.test(id)) throw notFound();
    return this.db.transaction(async (tx) => {
      const r = await this.lockOfCourier(tx, courierId, id);
      if (r.status !== from) throw AppError.conflict(`A request ${r.status} cannot become ${to}`, { reason: 'invalid_transition', from: r.status, to });
      const [u] = await tx.update(courierRequests).set({ ...set, status: to }).where(eq(courierRequests.id, id)).returning();
      await this.audit.record(
        { action: 'courier_request.status_changed', actorUserId: courierId, subjectUserId: r.requesterId, meta, metadata: { requestId: id, from, to, courierUserId: courierId } },
        tx,
      );
      return u!;
    });
  }

  private async lockOfCourier(tx: Tx, courierId: string, id: string): Promise<CourierRequestRow> {
    const [r] = await tx.select().from(courierRequests).where(and(eq(courierRequests.id, id), eq(courierRequests.courierId, courierId))).for('update').limit(1);
    if (!r) throw notFound();
    return r;
  }

  private async ofParty(exec: Pick<Db, 'select'>, userId: string, id: string, lock = false): Promise<CourierRequestRow> {
    if (!UUID_RE.test(id)) throw notFound();
    const q = exec
      .select()
      .from(courierRequests)
      .where(and(eq(courierRequests.id, id), or(eq(courierRequests.requesterId, userId), eq(courierRequests.courierId, userId))))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw notFound();
    return r;
  }

  /** Generic text only: no address, no note, no code. */
  private async tell(userId: string, row: CourierRequestRow, body: string): Promise<void> {
    await this.notifications.notify({ userId, category: 'delivery', title: 'Coursier à la demande', body, data: { courierRequestId: row.id } });
    this.realtime.emitToUser(userId, 'delivery.updated', { courierRequestId: row.id, status: row.status });
  }

  private async views(rows: CourierRequestRow[], viewerId: string): Promise<CourierRequest[]> {
    if (rows.length === 0) return [];
    const partyIds = [...new Set(rows.flatMap((r) => [r.requesterId, r.courierId].filter((v): v is string => v !== null)))];
    const people = await this.db.select({ id: users.id, handle: users.handle, displayName: users.displayName }).from(users).where(inArray(users.id, partyIds));
    const byId = new Map<string, Party>(people.map((p) => [p.id, p]));
    const now = new Date();
    return rows.map((r) => {
      const asRequester = r.requesterId === viewerId;
      const status = effectiveStatus(r, now);
      const other = byId.get(asRequester ? (r.courierId ?? '') : r.requesterId);
      const live = status === 'requested' || status === 'accepted' || status === 'picked_up';
      // The courier keeps the exact points and the note only while the request is under way; the exact drop-off only once picked up.
      const closedForCourier = !asRequester && (status === 'delivered' || status === 'cancelled');
      const pickup = closedForCourier ? blurred(r.pickupLat, r.pickupLng) : { lat: r.pickupLat, lng: r.pickupLng, label: r.pickupLabel };
      const dropoff = closedForCourier || (!asRequester && status === 'accepted') ? blurred(r.dropoffLat, r.dropoffLng) : { lat: r.dropoffLat, lng: r.dropoffLng, label: r.dropoffLabel };
      return {
        id: r.id,
        role: asRequester ? 'requester' : 'courier',
        kind: r.kind,
        size: r.size ?? null,
        status,
        pickup,
        dropoff,
        note: closedForCourier ? null : r.note,
        currency: r.currency.trim(),
        feeMinor: r.feeEstimateMinor,
        distanceKm: r.distanceKm,
        proofCode: asRequester && live ? this.codes.codeFor(r.id, r.proofNonce) : null,
        proofLockedUntil: r.proofLockedUntil && r.proofLockedUntil.getTime() > now.getTime() ? r.proofLockedUntil.toISOString() : null,
        counterpart: other ? { userId: other.id, handle: other.handle, displayName: other.displayName } : null,
        locationSharing: r.locationConsent,
        location:
          asRequester && status === 'picked_up' && r.lastLat !== null && r.lastLng !== null && r.lastLocationAt
            ? { lat: r.lastLat, lng: r.lastLng, updatedAt: r.lastLocationAt.toISOString() }
            : null,
        ratingGiven: asRequester ? r.requesterRating : r.courierRating,
        ratingReceived: asRequester ? r.courierRating : r.requesterRating,
        scheduledFor: iso(r.scheduledFor),
        expiresAt: r.expiresAt.toISOString(),
        acceptedAt: iso(r.acceptedAt),
        pickedUpAt: iso(r.pickedUpAt),
        deliveredAt: iso(r.deliveredAt),
        cancelledAt: iso(r.cancelledAt),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}

