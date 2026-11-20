import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateRoadsideRequest,
  ROADSIDE_OPEN_MAX,
  ROADSIDE_SAFETY_NOTE,
  ROADSIDE_TTL_MINUTES,
  type RoadsideMineQuery,
  type RoadsideOfferList,
  type RoadsideOffersQuery,
  type RoadsideRequest,
  type RoadsideRequestList,
  type RoadsideStatus,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { conflict, forbiddenBecause, HAVERSINE_SQL, UUID_RE } from '../mobility/mobility.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Tx } from '../orgs/orgs.service.js';
import { KycPort } from '../wallet/kyc.port.js';
import { blockedBetween, isoOf, isoOrNull, requireApprovedDriver, rowsOf } from './extra.shared.js';

const PAYMENT_NOTE = 'Aucun paiement en ligne : le prix est convenu avec le prestataire et réglé sur place, en espèces.';

/** A provider carries at most this many requests at once. */
const PROVIDER_ACTIVE_MAX = 2;
const DEFAULT_RADIUS_KM = 15;
/** Providers notified when a request is created: online, with a fresh position nearby. */
const NOTIFIED_PROVIDERS = 20;

const notFound = () => AppError.notFound('Roadside request not found');

interface Row {
  id: string;
  requester_id: string;
  kind: RoadsideRequest['kind'];
  lat: number;
  lng: number;
  label: string;
  vehicle_label: string | null;
  note: string | null;
  status: RoadsideStatus;
  provider_id: string | null;
  eta_minutes: number | null;
  location_consent: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: Date | null;
  created_at: Date;
  expires_at: Date;
}

/** Still `requested` past its deadline: it reads as expired before the maintenance job writes it. */
const effective = (r: Row, now: Date): RoadsideStatus => (r.status === 'requested' && r.expires_at.getTime() <= now.getTime() ? 'expired' : r.status);

@Injectable()
export class RoadsideService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kyc: KycPort,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ requester side */

  async create(userId: string, body: CreateRoadsideRequest, meta: RequestMeta): Promise<RoadsideRequest> {
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'roadside:' + userId}))`);
      const [c] = await rowsOf<{ n: number }>(
        tx,
        sql`SELECT count(*)::int AS n FROM roadside_requests WHERE requester_id = ${userId}::uuid
              AND (status IN ('accepted', 'on_the_way') OR (status = 'requested' AND expires_at > now()))`,
      );
      if ((c?.n ?? 0) >= ROADSIDE_OPEN_MAX) throw conflict('Too many open roadside requests', 'open_limit', { max: ROADSIDE_OPEN_MAX });
      const [r] = await rowsOf<Row>(
        tx,
        sql`INSERT INTO roadside_requests (requester_id, kind, lat, lng, label, vehicle_label, note, expires_at)
            VALUES (${userId}::uuid, ${body.kind}, ${body.position.lat}, ${body.position.lng}, ${body.position.label}, ${body.vehicleLabel ?? null}, ${body.note ?? null},
              now() + make_interval(mins => ${ROADSIDE_TTL_MINUTES}))
            RETURNING *`,
      );
      await this.audit.record({ action: 'roadside.created', actorUserId: userId, meta, metadata: { requestId: r!.id, kind: body.kind } }, tx);
      return r!;
    });
    await this.notifyNearby(row);
    return (await this.views([row], userId))[0]!;
  }

  async mine(userId: string, q: RoadsideMineQuery): Promise<RoadsideRequestList> {
    const col = q.role === 'requester' ? sql`requester_id` : sql`provider_id`;
    const rows = await rowsOf<Row>(this.db, sql`SELECT * FROM roadside_requests WHERE ${col} = ${userId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${q.limit}`);
    return { items: await this.views(rows, userId) };
  }

  async get(userId: string, id: string): Promise<RoadsideRequest> {
    const r = await this.ofParty(this.db, userId, id);
    return (await this.views([r], userId))[0]!;
  }

  async cancel(userId: string, id: string, meta: RequestMeta): Promise<RoadsideRequest> {
    const out = await this.db.transaction(async (tx) => {
      const r = await this.ofParty(tx, userId, id, true);
      if (r.requester_id !== userId) throw notFound();
      const st = effective(r, new Date());
      if (st !== 'requested' && st !== 'accepted' && st !== 'on_the_way') throw conflict(`A ${st} request cannot be cancelled`, 'invalid_transition', { from: st });
      const [u] = await rowsOf<Row>(
        tx,
        sql`UPDATE roadside_requests SET status = 'cancelled', cancelled_at = now(), location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL WHERE id = ${id}::uuid RETURNING *`,
      );
      await this.audit.record({ action: 'roadside.status_changed', actorUserId: userId, meta, metadata: { requestId: id, from: r.status, to: 'cancelled' } }, tx);
      return { row: u!, provider: r.provider_id };
    });
    if (out.provider) await this.tell(out.provider, 'Le demandeur a annulé la demande de dépannage.', id);
    return (await this.views([out.row], userId))[0]!;
  }

  /* ------------------------------------------------------------------ provider side */

  /** Open requests around a position, nearest first. Rounded coordinates, no label, no note, no requester before acceptance. */
  async offers(providerId: string, q: RoadsideOffersQuery): Promise<RoadsideOfferList> {
    await requireApprovedDriver(this.db, this.kyc, providerId);
    const radius = q.radiusKm ?? DEFAULT_RADIUS_KM;
    const plat = 'round(r.lat::numeric, 3)::float8';
    const plng = 'round(r.lng::numeric, 3)::float8';
    const dist = sql.raw(HAVERSINE_SQL(String(q.lat), String(q.lng), plat, plng));
    const rows = await rowsOf<{ id: string; kind: RoadsideRequest['kind']; plat: number; plng: number; d: number; expires_at: Date; created_at: Date }>(
      this.db,
      sql`SELECT * FROM (
            SELECT r.id, r.kind, r.expires_at, r.created_at, ${sql.raw(plat)} AS plat, ${sql.raw(plng)} AS plng, ${dist} AS d
            FROM roadside_requests r
            WHERE r.status = 'requested' AND r.expires_at > now() AND r.requester_id <> ${providerId}::uuid
              AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = r.requester_id AND b.blocked_id = ${providerId}::uuid)
                                                              OR (b.blocker_id = ${providerId}::uuid AND b.blocked_id = r.requester_id))
          ) x WHERE d <= ${radius} ORDER BY d, created_at, id LIMIT 20`,
    );
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, position: { lat: r.plat, lng: r.plng }, distanceKm: Math.round(r.d * 100) / 100, expiresAt: isoOf(r.expires_at), createdAt: isoOf(r.created_at) })) };
  }

  /** First come, first served: the second provider waits on the row lock and then sees it taken (409). */
  async accept(providerId: string, id: string, meta: RequestMeta): Promise<RoadsideRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    await requireApprovedDriver(this.db, this.kyc, providerId);
    const row = await this.db.transaction(async (tx) => {
      const [r] = await rowsOf<Row>(tx, sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid FOR UPDATE`);
      if (!r) throw notFound();
      if (r.requester_id === providerId) throw forbiddenBecause('You cannot accept your own request', 'own_request');
      if (await blockedBetween(tx, r.requester_id, providerId)) throw notFound();
      if (effective(r, new Date()) !== 'requested') throw conflict('This request is no longer available', 'request_unavailable');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'roadside-provider:' + providerId}))`);
      const [c] = await rowsOf<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM roadside_requests WHERE provider_id = ${providerId}::uuid AND status IN ('accepted', 'on_the_way')`);
      if ((c?.n ?? 0) >= PROVIDER_ACTIVE_MAX) throw conflict('You already carry too many requests', 'provider_busy', { max: PROVIDER_ACTIVE_MAX });
      const [u] = await rowsOf<Row>(tx, sql`UPDATE roadside_requests SET status = 'accepted', provider_id = ${providerId}::uuid, accepted_at = now() WHERE id = ${id}::uuid RETURNING *`);
      await this.audit.record({ action: 'roadside.status_changed', actorUserId: providerId, meta, metadata: { requestId: id, from: 'requested', to: 'accepted', providerUserId: providerId } }, tx);
      return u!;
    });
    await this.tell(row.requester_id, 'Un prestataire a accepté votre demande de dépannage.', id);
    return (await this.views([row], providerId))[0]!;
  }

  async onTheWay(providerId: string, id: string, etaMinutes: number, meta: RequestMeta): Promise<RoadsideRequest> {
    const row = await this.step(providerId, id, ['accepted', 'on_the_way'], 'on_the_way', sql`, eta_minutes = ${etaMinutes}`, meta);
    await this.tell(row.requester_id, `Le prestataire est en route (environ ${etaMinutes} min).`, id);
    return (await this.views([row], providerId))[0]!;
  }

  async done(providerId: string, id: string, meta: RequestMeta): Promise<RoadsideRequest> {
    const row = await this.step(providerId, id, ['accepted', 'on_the_way'], 'done', sql`, done_at = now(), location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL`, meta);
    await this.tell(row.requester_id, 'Le dépannage est terminé.', id);
    return (await this.views([row], providerId))[0]!;
  }

  /** A provider who cannot go after all hands the request back to the open list. */
  async release(providerId: string, id: string, meta: RequestMeta): Promise<RoadsideRequest> {
    const row = await this.step(
      providerId, id, ['accepted', 'on_the_way'], 'requested',
      sql`, provider_id = NULL, eta_minutes = NULL, accepted_at = NULL, location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL`, meta,
    );
    await this.tell(row.requester_id, 'Le prestataire s’est désisté : votre demande est de nouveau ouverte.', id);
    return (await this.views([row], providerId))[0]!;
  }

  /** The provider agrees (or stops agreeing) to share their position with the requester; withdrawing erases the last point. */
  async setLocationConsent(providerId: string, id: string, granted: boolean): Promise<RoadsideRequest> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = await this.db.transaction(async (tx) => {
      const [r] = await rowsOf<Row>(tx, sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid AND provider_id = ${providerId}::uuid FOR UPDATE`);
      if (!r) throw notFound();
      if (r.status !== 'accepted' && r.status !== 'on_the_way') throw conflict('The request is not under way', 'invalid_transition', { from: r.status });
      const [u] = await rowsOf<Row>(
        tx,
        granted
          ? sql`UPDATE roadside_requests SET location_consent = true WHERE id = ${id}::uuid RETURNING *`
          : sql`UPDATE roadside_requests SET location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL WHERE id = ${id}::uuid RETURNING *`,
      );
      return u!;
    });
    return (await this.views([row], providerId))[0]!;
  }

  /** Last known position of the provider, with consent, while under way; no history. */
  async postLocation(providerId: string, id: string, lat: number, lng: number): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound();
    const done = await rowsOf(
      this.db,
      sql`UPDATE roadside_requests SET last_lat = ${lat}, last_lng = ${lng}, last_location_at = now()
          WHERE id = ${id}::uuid AND provider_id = ${providerId}::uuid AND status IN ('accepted', 'on_the_way') AND location_consent RETURNING id`,
    );
    if (done.length > 0) return;
    const [r] = await rowsOf<Row>(this.db, sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid AND provider_id = ${providerId}::uuid`);
    if (!r) throw notFound();
    if (r.status !== 'accepted' && r.status !== 'on_the_way') throw conflict('The request is not under way', 'not_under_way');
    throw forbiddenBecause('Location sharing was not accepted by the provider', 'location_consent_required');
  }

  /* ------------------------------------------------------------------ internals */

  private async step(providerId: string, id: string, from: RoadsideStatus[], to: RoadsideStatus, extra: ReturnType<typeof sql>, meta: RequestMeta): Promise<Row> {
    if (!UUID_RE.test(id)) throw notFound();
    return this.db.transaction(async (tx) => {
      const [r] = await rowsOf<Row>(tx, sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid AND provider_id = ${providerId}::uuid FOR UPDATE`);
      if (!r) throw notFound();
      if (!from.includes(r.status)) throw conflict(`A ${r.status} request cannot take this step`, 'invalid_transition', { from: r.status, to });
      const [u] = await rowsOf<Row>(tx, sql`UPDATE roadside_requests SET status = ${to}${extra} WHERE id = ${id}::uuid RETURNING *`);
      await this.audit.record({ action: 'roadside.status_changed', actorUserId: providerId, meta, metadata: { requestId: id, from: r.status, to, providerUserId: providerId } }, tx);
      return u!;
    });
  }

  private async ofParty(exec: Pick<Db, 'execute'> | Tx, userId: string, id: string, lock = false): Promise<Row> {
    if (!UUID_RE.test(id)) throw notFound();
    const [r] = await rowsOf<Row>(
      exec,
      lock
        ? sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid AND (requester_id = ${userId}::uuid OR provider_id = ${userId}::uuid) FOR UPDATE`
        : sql`SELECT * FROM roadside_requests WHERE id = ${id}::uuid AND (requester_id = ${userId}::uuid OR provider_id = ${userId}::uuid)`,
    );
    if (!r) throw notFound();
    return r;
  }

  private async tell(userId: string, body: string, id: string): Promise<void> {
    await this.notifications.notify({ userId, category: 'system', title: 'Dépannage', body, data: { roadsideId: id } });
  }

  /** Approved drivers online with a fresh position near the request; they are told generically, without any detail. */
  private async notifyNearby(r: Row): Promise<void> {
    const dist = HAVERSINE_SQL(String(r.lat), String(r.lng), 'd.last_lat', 'd.last_lng');
    const rows = await rowsOf<{ user_id: string }>(
      this.db,
      sql`SELECT d.user_id FROM mobility_drivers d
          WHERE d.status = 'approved' AND d.online AND d.last_lat IS NOT NULL AND d.last_location_at > now() - interval '5 minutes' AND d.user_id <> ${r.requester_id}::uuid
            AND ${sql.raw(dist)} <= ${DEFAULT_RADIUS_KM}
            AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${r.requester_id}::uuid AND b.blocked_id = d.user_id) OR (b.blocker_id = d.user_id AND b.blocked_id = ${r.requester_id}::uuid))
          LIMIT ${NOTIFIED_PROVIDERS}`,
    );
    await this.notifications.notifyMany(rows.map((d) => ({ userId: d.user_id, category: 'system' as const, title: 'Dépannage', body: 'Une demande de dépannage est ouverte près de vous.', data: { roadsideId: r.id } })));
  }

  private async views(rows: Row[], viewerId: string): Promise<RoadsideRequest[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    const peopleIds = [...new Set(rows.map((r) => (r.requester_id === viewerId ? r.provider_id : r.requester_id)).filter((x): x is string => !!x))];
    const people = peopleIds.length
      ? await rowsOf<{ id: string; handle: string; display_name: string }>(this.db, sql`SELECT id, handle::text AS handle, display_name FROM users WHERE id IN (${sql.join(peopleIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => {
      const asRequester = r.requester_id === viewerId;
      const other = byId.get((asRequester ? r.provider_id : r.requester_id) ?? '');
      const st = effective(r, now);
      const underWay = st === 'accepted' || st === 'on_the_way';
      // A provider only learns where the requester is, and what they wrote, once they are on the job.
      const hide = !asRequester && !underWay;
      return {
        id: r.id,
        role: asRequester ? ('requester' as const) : ('provider' as const),
        kind: r.kind,
        status: st,
        position: hide ? { lat: 0, lng: 0, label: '' } : { lat: r.lat, lng: r.lng, label: r.label },
        vehicleLabel: r.vehicle_label,
        note: hide ? null : r.note,
        etaMinutes: r.eta_minutes,
        counterpart: other ? { id: other.id, handle: other.handle, displayName: other.display_name } : null,
        locationSharing: r.location_consent,
        providerLocation:
          asRequester && underWay && r.location_consent && r.last_lat !== null && r.last_lng !== null && r.last_location_at
            ? { lat: r.last_lat, lng: r.last_lng, updatedAt: isoOrNull(r.last_location_at)! }
            : null,
        expiresAt: isoOf(r.expires_at),
        createdAt: isoOf(r.created_at),
        safetyNote: ROADSIDE_SAFETY_NOTE,
        paymentNote: PAYMENT_NOTE,
      };
    });
  }
}
