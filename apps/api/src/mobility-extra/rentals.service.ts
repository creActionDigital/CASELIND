import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateRentalBookingRequest,
  type CreateRentalVehicleRequest,
  type OrgRentalListQuery,
  type OrgRole,
  RENTAL_OPEN_BOOKINGS_MAX,
  type RentalBooking,
  type RentalBookingList,
  type RentalBookingListQuery,
  type RentalBookingStatus,
  type RentalDetailQuery,
  type RentalKind,
  type RentalSearchQuery,
  type RentalVehicle,
  type RentalVehicleList,
  type UpdateRentalVehicleRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { contentUrlOf } from '../media/media.service.js';
import { conflict, UUID_RE, validation } from '../mobility/mobility.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import type { Tx } from '../orgs/orgs.service.js';
import { decodeCursor, encodeCursor, type Exec, isoOf, num, PAY_CASH_NOTE, rowsOf, uuidList } from './extra.shared.js';
import { isRealDay, periodProblem, rentalDays, rentalTotalMinor, todayUtc } from './rentals.logic.js';

const vehicleNotFound = () => AppError.notFound('Vehicle not found');
const bookingNotFound = () => AppError.notFound('Booking not found');

interface VehicleRow {
  id: string;
  org_id: string;
  title: string;
  kind: RentalKind;
  make: string | null;
  model: string | null;
  year: number | null;
  seats: number | null;
  transmission: 'manual' | 'auto' | null;
  fuel: 'petrol' | 'diesel' | 'electric' | 'hybrid' | null;
  daily_rate_minor: string | number;
  currency: string;
  deposit_minor: string | number | null;
  city: string;
  description: string | null;
  active: boolean;
  created_at: Date;
  cur_ts: string;
  org_name: string;
  org_slug: string;
  media_ids: string[] | null;
}
interface BookingRow {
  id: string;
  vehicle_id: string;
  renter_id: string;
  starts_on: string;
  ends_on: string;
  daily_rate_minor: string | number;
  deposit_minor: string | number | null;
  total_minor: string | number;
  currency: string;
  status: RentalBookingStatus;
  note: string | null;
  created_at: Date;
  v_title: string;
  org_id: string;
  org_name: string;
  handle: string;
  display_name: string;
}

const VEHICLE_SELECT = sql`
  SELECT v.*, to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cur_ts, o.name AS org_name, o.slug::text AS org_slug,
         (SELECT array_agg(m.media_id ORDER BY m.position) FROM rental_vehicle_media m WHERE m.vehicle_id = v.id) AS media_ids
  FROM rental_vehicles v JOIN organizations o ON o.id = v.org_id`;
const BOOKING_SELECT = sql`
  SELECT b.id, b.vehicle_id, b.renter_id, b.starts_on::text AS starts_on, b.ends_on::text AS ends_on, b.daily_rate_minor, b.deposit_minor, b.total_minor, b.currency,
         b.status, b.note, b.created_at, v.title AS v_title, v.org_id, o.name AS org_name, u.handle::text AS handle, u.display_name
  FROM rental_bookings b JOIN rental_vehicles v ON v.id = b.vehicle_id JOIN organizations o ON o.id = v.org_id JOIN users u ON u.id = b.renter_id`;
/** Public vehicles: active, of an active and public organisation. */
const PUBLIC_VEHICLE = sql`v.active AND o.status = 'active' AND o.visibility = 'public'`;

@Injectable()
export class RentalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ organisation side: vehicles */

  async createVehicle(orgId: string, userId: string, body: CreateRentalVehicleRequest, meta: RequestMeta): Promise<RentalVehicle> {
    await this.checkMedia(userId, body.mediaIds ?? []);
    const id = await this.db.transaction(async (tx) => {
      const [r] = await rowsOf<{ id: string }>(
        tx,
        sql`INSERT INTO rental_vehicles (org_id, title, kind, make, model, year, seats, transmission, fuel, daily_rate_minor, currency, deposit_minor, city, description, active)
            VALUES (${orgId}::uuid, ${body.title}, ${body.kind}, ${body.make ?? null}, ${body.model ?? null}, ${body.year ?? null}, ${body.seats ?? null},
              ${body.transmission ?? null}, ${body.fuel ?? null}, ${body.dailyRateMinor}, ${body.currency ?? 'USD'}, ${body.depositMinor ?? null}, ${body.city},
              ${body.description ?? null}, ${body.active ?? true})
            RETURNING id`,
      );
      await this.setMedia(tx, r!.id, body.mediaIds ?? []);
      await this.audit.record({ action: 'rental.vehicle_saved', actorUserId: userId, meta, metadata: { orgId, vehicleId: r!.id, created: true, kind: body.kind, currency: body.currency ?? 'USD' } }, tx);
      return r!.id;
    });
    return this.orgVehicle(orgId, id);
  }

  async updateVehicle(orgId: string, userId: string, id: string, body: UpdateRentalVehicleRequest, meta: RequestMeta): Promise<RentalVehicle> {
    if (!UUID_RE.test(id)) throw vehicleNotFound();
    if (body.mediaIds) await this.checkMedia(userId, body.mediaIds);
    await this.db.transaction(async (tx) => {
      const [v] = await rowsOf<VehicleRow>(tx, sql`SELECT * FROM rental_vehicles WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
      if (!v) throw vehicleNotFound();
      const pick = <K extends keyof UpdateRentalVehicleRequest>(k: K, cur: unknown) => (body[k] === undefined ? cur : body[k]);
      await tx.execute(sql`
        UPDATE rental_vehicles SET title = ${pick('title', v.title)}, kind = ${pick('kind', v.kind)}, make = ${pick('make', v.make)}, model = ${pick('model', v.model)},
          year = ${pick('year', v.year)}, seats = ${pick('seats', v.seats)}, transmission = ${pick('transmission', v.transmission)}, fuel = ${pick('fuel', v.fuel)},
          daily_rate_minor = ${pick('dailyRateMinor', v.daily_rate_minor)}, deposit_minor = ${pick('depositMinor', v.deposit_minor)}, city = ${pick('city', v.city)},
          description = ${pick('description', v.description)}, active = ${pick('active', v.active)}, updated_at = now()
        WHERE id = ${id}::uuid`);
      if (body.mediaIds) await this.setMedia(tx, id, body.mediaIds);
      await this.audit.record({ action: 'rental.vehicle_saved', actorUserId: userId, meta, metadata: { orgId, vehicleId: id, created: false, active: body.active ?? v.active } }, tx);
    });
    return this.orgVehicle(orgId, id);
  }

  async listOrgVehicles(orgId: string, q: OrgRentalListQuery): Promise<RentalVehicleList> {
    const rows = await rowsOf<VehicleRow>(this.db, sql`${VEHICLE_SELECT} WHERE v.org_id = ${orgId}::uuid ORDER BY v.created_at DESC, v.id DESC LIMIT ${q.limit}`);
    return { items: rows.map((r) => this.vehicleView(r, null, [])), nextCursor: null };
  }

  private async orgVehicle(orgId: string, id: string): Promise<RentalVehicle> {
    const [r] = await rowsOf<VehicleRow>(this.db, sql`${VEHICLE_SELECT} WHERE v.id = ${id}::uuid AND v.org_id = ${orgId}::uuid`);
    if (!r) throw vehicleNotFound();
    return this.vehicleView(r, null, []);
  }

  /* ------------------------------------------------------------------ renter side: search and detail */

  /** Vehicles free over the whole period (a confirmed or picked up rental that touches it takes the vehicle out). */
  async search(q: RentalSearchQuery): Promise<RentalVehicleList> {
    const filters = [PUBLIC_VEHICLE];
    if (q.city) filters.push(sql`position(lower(${q.city}) in lower(v.city)) > 0`);
    if (q.kind) filters.push(sql`v.kind = ${q.kind}`);
    if (q.from && q.to) {
      if (!isRealDay(q.from) || !isRealDay(q.to)) throw validation('from', 'not a calendar date', 'invalid_date');
      filters.push(sql`NOT EXISTS (SELECT 1 FROM rental_bookings b WHERE b.vehicle_id = v.id AND b.status IN ('confirmed', 'picked_up') AND b.starts_on <= ${q.to}::date AND b.ends_on >= ${q.from}::date)`);
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c || !UUID_RE.test(c.id)) throw validation('cursor', 'invalid cursor', 'invalid_cursor');
      filters.push(sql`(v.created_at, v.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await rowsOf<VehicleRow>(this.db, sql`${VEHICLE_SELECT} WHERE ${sql.join(filters, sql` AND `)} ORDER BY v.created_at DESC, v.id DESC LIMIT ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const days = q.from && q.to ? rentalDays(q.from, q.to) : null;
    return { items: page.map((r) => this.vehicleView(r, days, [])), nextCursor: rows.length > q.limit && last ? encodeCursor(last.cur_ts, last.id) : null };
  }

  async detail(id: string, q: RentalDetailQuery): Promise<RentalVehicle> {
    if (!UUID_RE.test(id)) throw vehicleNotFound();
    const [r] = await rowsOf<VehicleRow>(this.db, sql`${VEHICLE_SELECT} WHERE v.id = ${id}::uuid AND ${PUBLIC_VEHICLE}`);
    if (!r) throw vehicleNotFound();
    if (q.from && q.to && (!isRealDay(q.from) || !isRealDay(q.to))) throw validation('from', 'not a calendar date', 'invalid_date');
    const busy = await rowsOf<{ f: string; t: string }>(
      this.db,
      sql`SELECT starts_on::text AS f, ends_on::text AS t FROM rental_bookings WHERE vehicle_id = ${id}::uuid AND status IN ('confirmed', 'picked_up') AND ends_on >= current_date ORDER BY starts_on`,
    );
    return this.vehicleView(r, q.from && q.to ? rentalDays(q.from, q.to) : null, busy.map((b) => ({ from: b.f, to: b.t })));
  }

  /* ------------------------------------------------------------------ bookings */

  async book(renterId: string, vehicleId: string, body: CreateRentalBookingRequest, meta: RequestMeta): Promise<RentalBooking> {
    if (!UUID_RE.test(vehicleId)) throw vehicleNotFound();
    const problem = periodProblem(body.startsOn, body.endsOn, todayUtc());
    if (problem) throw validation('startsOn', `invalid period: ${problem}`, problem);
    const days = rentalDays(body.startsOn, body.endsOn);
    const made = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'rental-renter:' + renterId}))`);
      // The vehicle row is the lock of every booking decision on it.
      const [v] = await rowsOf<VehicleRow>(tx, sql`SELECT v.*, o.name AS org_name FROM rental_vehicles v JOIN organizations o ON o.id = v.org_id WHERE v.id = ${vehicleId}::uuid AND ${PUBLIC_VEHICLE} FOR UPDATE OF v`);
      if (!v) throw vehicleNotFound();
      if (await this.overlaps(tx, vehicleId, body.startsOn, body.endsOn)) throw conflict('The vehicle is not available on this period', 'unavailable');
      const [c] = await rowsOf<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM rental_bookings WHERE renter_id = ${renterId}::uuid AND status IN ('requested', 'confirmed', 'picked_up')`);
      if ((c?.n ?? 0) >= RENTAL_OPEN_BOOKINGS_MAX) throw conflict('Too many live rental requests', 'booking_limit', { max: RENTAL_OPEN_BOOKINGS_MAX });
      const total = rentalTotalMinor(days, num(v.daily_rate_minor));
      const [b] = await rowsOf<{ id: string }>(
        tx,
        sql`INSERT INTO rental_bookings (vehicle_id, renter_id, starts_on, ends_on, daily_rate_minor, deposit_minor, total_minor, currency, note)
            VALUES (${vehicleId}::uuid, ${renterId}::uuid, ${body.startsOn}::date, ${body.endsOn}::date, ${num(v.daily_rate_minor)}, ${v.deposit_minor === null ? null : num(v.deposit_minor)},
              ${total}, ${v.currency}, ${body.note ?? null})
            RETURNING id`,
      );
      await this.audit.record(
        { action: 'rental.booking_created', actorUserId: renterId, meta, metadata: { orgId: v.org_id, vehicleId, bookingId: b!.id, days, totalMinor: total, currency: v.currency } },
        tx,
      );
      return { id: b!.id, orgId: v.org_id };
    });
    await this.tellOrg(made.orgId, 'Nouvelle demande de location de véhicule.', made.id);
    return this.bookingView(made.id, false);
  }

  async myBookings(renterId: string, q: RentalBookingListQuery): Promise<RentalBookingList> {
    const filters = [sql`b.renter_id = ${renterId}::uuid`];
    if (q.status) filters.push(sql`b.status = ${q.status}`);
    const rows = await rowsOf<BookingRow>(this.db, sql`${BOOKING_SELECT} WHERE ${sql.join(filters, sql` AND `)} ORDER BY b.created_at DESC, b.id DESC LIMIT ${q.limit}`);
    return { items: rows.map((r) => bookingOf(r, false)) };
  }

  async cancelByRenter(renterId: string, id: string, meta: RequestMeta): Promise<RentalBooking> {
    await this.step(id, { renterId }, ['requested', 'confirmed'], 'cancelled', renterId, meta);
    return this.bookingView(id, false);
  }

  /* ------------------------------------------------------------------ organisation side: requests */

  async orgBookings(orgId: string, q: RentalBookingListQuery): Promise<RentalBookingList> {
    const filters = [sql`v.org_id = ${orgId}::uuid`];
    if (q.status) filters.push(sql`b.status = ${q.status}`);
    const rows = await rowsOf<BookingRow>(this.db, sql`${BOOKING_SELECT} WHERE ${sql.join(filters, sql` AND `)} ORDER BY b.created_at DESC, b.id DESC LIMIT ${q.limit}`);
    return { items: rows.map((r) => bookingOf(r, true)) };
  }

  async orgStep(orgId: string, userId: string, id: string, action: 'confirm' | 'decline' | 'pickup' | 'return' | 'cancel', meta: RequestMeta): Promise<RentalBooking> {
    const map = {
      confirm: [['requested'], 'confirmed'],
      decline: [['requested'], 'declined'],
      pickup: [['confirmed'], 'picked_up'],
      return: [['picked_up'], 'returned'],
      cancel: [['requested', 'confirmed'], 'cancelled'],
    } as const;
    const [from, to] = map[action];
    await this.step(id, { orgId }, from, to, userId, meta);
    return this.bookingView(id, true);
  }

  /* ------------------------------------------------------------------ internals */

  /** Locks the vehicle, then the booking; applies one transition. Confirming re-checks the dates against the confirmed rentals. */
  private async step(
    id: string,
    scope: { renterId: string; orgId?: undefined } | { orgId: string; renterId?: undefined },
    from: readonly RentalBookingStatus[],
    to: RentalBookingStatus,
    actor: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (!UUID_RE.test(id)) throw bookingNotFound();
    const told = await this.db.transaction(async (tx) => {
      const [ref] = await rowsOf<{ vehicle_id: string }>(tx, sql`SELECT vehicle_id FROM rental_bookings WHERE id = ${id}::uuid`);
      if (!ref) throw bookingNotFound();
      const [v] = await rowsOf<{ org_id: string }>(tx, sql`SELECT org_id FROM rental_vehicles WHERE id = ${ref.vehicle_id}::uuid FOR UPDATE`);
      const [b] = await rowsOf<BookingRow>(tx, sql`SELECT id, vehicle_id, renter_id, starts_on::text AS starts_on, ends_on::text AS ends_on, status FROM rental_bookings WHERE id = ${id}::uuid FOR UPDATE`);
      if (!v || !b) throw bookingNotFound();
      if (scope.renterId !== undefined ? b.renter_id !== scope.renterId : v.org_id !== scope.orgId) throw bookingNotFound();
      if (!from.includes(b.status)) throw conflict(`A ${b.status} rental cannot become ${to}`, 'invalid_transition', { from: b.status, to });
      if (to === 'confirmed' && (await this.overlaps(tx, b.vehicle_id, b.starts_on, b.ends_on, b.id))) throw conflict('The vehicle is not available on this period', 'unavailable');
      if (to === 'confirmed' && b.starts_on < todayUtc()) throw conflict('The requested period has already started', 'too_late');
      if (to === 'picked_up' && b.starts_on > todayUtc()) throw conflict('The rental has not started yet', 'too_early');
      await tx.execute(sql`UPDATE rental_bookings SET status = ${to}, updated_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'rental.booking_status_changed', actorUserId: actor, meta, metadata: { orgId: v.org_id, vehicleId: b.vehicle_id, bookingId: id, from: b.status, to } }, tx);
      return { renterId: b.renter_id, orgId: v.org_id };
    });
    if (scope.renterId !== undefined) await this.tellOrg(told.orgId, 'Une demande de location a été annulée par le locataire.', id);
    else await this.notifications.notify({ userId: told.renterId, category: 'system', title: 'Location de véhicule', body: STATUS_TEXT[to] ?? 'Votre location a été mise à jour.', data: { bookingId: id } });
  }

  /** A confirmed or picked up rental of the vehicle shares a day with the period. */
  private async overlaps(exec: Exec, vehicleId: string, from: string, to: string, exceptId?: string): Promise<boolean> {
    const r = await exec.execute(sql`
      SELECT 1 FROM rental_bookings WHERE vehicle_id = ${vehicleId}::uuid AND status IN ('confirmed', 'picked_up')
        AND starts_on <= ${to}::date AND ends_on >= ${from}::date AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid) LIMIT 1`);
    return r.rows.length > 0;
  }

  private async tellOrg(orgId: string, body: string, bookingId: string): Promise<void> {
    const members = await rowsOf<{ user_id: string; role: OrgRole }>(this.db, sql`SELECT user_id, role FROM org_members WHERE org_id = ${orgId}::uuid AND status = 'active'`);
    const to = members.filter((m) => roleHasPermission(m.role, 'catalog.manage')).map((m) => m.user_id);
    await this.notifications.notifyMany(to.map((userId) => ({ userId, category: 'system' as const, title: 'Location de véhicule', body, data: { bookingId, orgId } })));
  }

  private async bookingView(id: string, forOrg: boolean): Promise<RentalBooking> {
    const [r] = await rowsOf<BookingRow>(this.db, sql`${BOOKING_SELECT} WHERE b.id = ${id}::uuid`);
    return bookingOf(r!, forOrg);
  }

  private async checkMedia(userId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    if (new Set(mediaIds).size !== mediaIds.length) throw validation('mediaIds', 'duplicate media', 'duplicate_media');
    const res = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM media_assets WHERE id IN (${uuidList(mediaIds)}) AND owner_user_id = ${userId}::uuid AND purpose = 'listing' AND status = 'ready'`);
    if ((res.rows[0]?.n ?? 0) !== mediaIds.length) throw validation('mediaIds', 'must be your own ready uploads with purpose "listing"', 'invalid_media');
  }

  private async setMedia(tx: Tx, vehicleId: string, mediaIds: string[]): Promise<void> {
    await tx.execute(sql`DELETE FROM rental_vehicle_media WHERE vehicle_id = ${vehicleId}::uuid`);
    for (const [position, mediaId] of mediaIds.entries()) {
      await tx.execute(sql`INSERT INTO rental_vehicle_media (vehicle_id, media_id, position) VALUES (${vehicleId}::uuid, ${mediaId}::uuid, ${position})`);
    }
  }

  private vehicleView(r: VehicleRow, days: number | null, busy: { from: string; to: string }[]): RentalVehicle {
    const rate = num(r.daily_rate_minor);
    const ids = r.media_ids ?? [];
    return {
      id: r.id,
      org: { id: r.org_id, name: r.org_name, slug: r.org_slug },
      title: r.title,
      kind: r.kind,
      make: r.make,
      model: r.model,
      year: r.year,
      seats: r.seats,
      transmission: r.transmission,
      fuel: r.fuel,
      dailyRateMinor: rate,
      currency: r.currency.trim(),
      depositMinor: r.deposit_minor === null ? null : num(r.deposit_minor),
      city: r.city,
      description: r.description,
      photoUrls: ids.map((m) => contentUrlOf(m)),
      mediaIds: ids,
      active: r.active,
      days,
      totalMinor: days === null ? null : rentalTotalMinor(days, rate),
      busy,
      paymentNote: PAY_CASH_NOTE,
      createdAt: isoOf(r.created_at),
    };
  }
}

const STATUS_TEXT: Partial<Record<RentalBookingStatus, string>> = {
  confirmed: 'Votre demande de location a été confirmée.',
  declined: 'Votre demande de location a été refusée.',
  picked_up: 'Le véhicule vous a été remis.',
  returned: 'Le véhicule a été rendu. Merci !',
  cancelled: 'Votre location a été annulée par l’organisation.',
};

const bookingOf = (r: BookingRow, forOrg: boolean): RentalBooking => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  vehicleTitle: r.v_title,
  orgId: r.org_id,
  orgName: r.org_name,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  days: rentalDays(r.starts_on, r.ends_on),
  dailyRateMinor: num(r.daily_rate_minor),
  depositMinor: r.deposit_minor === null ? null : num(r.deposit_minor),
  totalMinor: num(r.total_minor),
  currency: r.currency.trim(),
  status: r.status,
  note: r.note,
  renter: forOrg ? { id: r.renter_id, handle: r.handle, displayName: r.display_name } : null,
  paymentNote: PAY_CASH_NOTE,
  createdAt: isoOf(r.created_at),
});
