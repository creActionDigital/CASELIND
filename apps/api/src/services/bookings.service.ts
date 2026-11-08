import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  Booking,
  BookingDetail,
  BookingList,
  BookingListQuery,
  CreateBookingRequest,
  CreateServiceReviewRequest,
  OrgRole,
  PageQuery,
  ProposeQuoteRequest,
  ServiceReview,
  ServiceReviewList,
  ServiceReviewReplyRequest,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import { pgErrorOf } from '../orgs/orgs.service.js';
import { providerRefOf, ServicesService, serviceNotFound } from './services.service.js';
import { decodeCursor, encodeCursor, serviceVisibleSql, UUID_RE, validationError } from './services.shared.js';

const bookingNotFound = () => AppError.notFound('Booking not found');
const reviewNotFound = () => AppError.notFound('Review not found');
const invalidTransition = (from: string, action: string) =>
  AppError.conflict('This action is not possible in the current state of the booking', { reason: 'invalid_transition', from, action });

type Side = 'client' | 'provider';
type Action = 'confirm' | 'decline' | 'cancel' | 'complete' | 'no_show' | 'quote' | 'quote_accept' | 'quote_decline';

interface BookingRow {
  id: string;
  offer_id: string;
  client_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  status: Booking['status'];
  note: string | null;
  amount_minor: string | number | null;
  currency: string | null;
  quote_status: Booking['quoteStatus'];
  status_changed_at: string | Date;
  status_changed_by: 'client' | 'provider' | 'system';
  created_at: string | Date;
  updated_at: string | Date;
  ts: string;
  offer_title: string;
  price_kind: 'fixed' | 'quote';
  cancel_notice_hours: number;
  org_id: string | null;
  provider_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  org_verified: boolean | null;
  prov_name: string | null;
  prov_verified: boolean | null;
  prov_handle: string | null;
  client_handle: string;
  client_name: string;
  review_id: string | null;
}

const BOOKING_SELECT = sql`SELECT b.*, b.created_at::text AS ts, s.title AS offer_title, s.price_kind, s.cancel_notice_hours, s.org_id, s.provider_id,
    o.slug::text AS org_slug, o.name AS org_name, (o.verification_status = 'verified') AS org_verified,
    sp.display_name AS prov_name, (sp.verification_status = 'verified') AS prov_verified, pu.handle::text AS prov_handle,
    cu.handle::text AS client_handle, cu.display_name AS client_name,
    (SELECT r.id FROM service_reviews r WHERE r.booking_id = b.id) AS review_id
  FROM service_bookings b
  JOIN service_offers s ON s.id = b.offer_id
  JOIN users cu ON cu.id = b.client_id
  LEFT JOIN organizations o ON o.id = s.org_id
  LEFT JOIN users pu ON pu.id = s.provider_id
  LEFT JOIN service_providers sp ON sp.user_id = s.provider_id`;

const iso = (v: string | Date): string => new Date(v).toISOString();

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    offerId: r.offer_id,
    offerTitle: r.offer_title,
    status: r.status,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    note: r.note,
    paymentMode: 'on_site',
    priceKind: r.price_kind,
    amountMinor: r.amount_minor === null ? null : Number(r.amount_minor),
    currency: r.currency?.trim() ?? null,
    quoteStatus: r.quote_status,
    cancelNoticeHours: r.cancel_notice_hours,
    statusChangedAt: iso(r.status_changed_at),
    statusChangedBy: r.status_changed_by,
    client: { userId: r.client_id, handle: r.client_handle, displayName: r.client_name },
    provider: providerRefOf(r),
    reviewId: r.review_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** Bookings (on-site payment only), quotes and verified reviews of services. */
@Injectable()
export class BookingsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly services: ServicesService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.moderation.register('service_review', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`
          SELECT 1 FROM service_reviews r
          JOIN service_offers s ON s.id = r.offer_id
          LEFT JOIN organizations o ON o.id = s.org_id
          LEFT JOIN users pu ON pu.id = s.provider_id
          WHERE r.id = ${id}::uuid AND (NOT r.hidden OR r.client_id = ${viewerId}::uuid) AND ${serviceVisibleSql(viewerId)}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute(sql`SELECT client_id FROM service_reviews WHERE id = ${id}::uuid`);
        return (res.rows[0] as { client_id: string } | undefined)?.client_id ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE service_reviews SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  // ---- creation ---------------------------------------------------------------------------------

  async create(userId: string, offerId: string, req: CreateBookingRequest): Promise<BookingDetail> {
    if (!UUID_RE.test(offerId)) throw serviceNotFound();
    const offer = await this.services.loadVisible(userId, offerId);
    if (!offer) throw serviceNotFound();
    if (offer.provider_id === userId || (offer.org_id && (await this.memberRole(offer.org_id, userId)))) {
      throw new AppError(403, 'forbidden', 'You cannot book your own service', { reason: 'own_service' });
    }
    const startsAt = new Date(req.startsAt);
    const now = new Date();
    if (startsAt <= now) throw validationError('startsAt', 'startsAt must be in the future');

    let bookingId: string;
    try {
      bookingId = await this.db.transaction(async (tx) => {
        // The offer row is the resource lock: concurrent requests for the same offer queue here, so the overlap check is exact.
        const locked = await tx.execute(sql`
          SELECT duration_min, utc_offset_minutes, price_kind, price_minor, currency FROM service_offers
          WHERE id = ${offerId}::uuid AND status = 'published' AND NOT hidden FOR UPDATE`);
        const cur = locked.rows[0] as
          | { duration_min: number; utc_offset_minutes: number; price_kind: 'fixed' | 'quote'; price_minor: string | number | null; currency: string | null }
          | undefined;
        if (!cur) throw serviceNotFound();
        const endsAt = new Date(startsAt.getTime() + cur.duration_min * 60_000);
        const overlap = await tx.execute(sql`
          SELECT 1 FROM service_bookings WHERE offer_id = ${offerId}::uuid AND status IN ('requested', 'confirmed')
            AND starts_at < ${endsAt.toISOString()}::timestamptz AND ends_at > ${startsAt.toISOString()}::timestamptz LIMIT 1`);
        if (overlap.rows.length > 0) throw AppError.conflict('This slot is already booked', { reason: 'slot_taken' });
        const free = await this.services.freeSlots(tx, { id: offerId, duration_min: cur.duration_min, utc_offset_minutes: cur.utc_offset_minutes }, startsAt, endsAt, now);
        if (!free.some((s) => s.start.getTime() === startsAt.getTime())) {
          throw AppError.conflict('This is not an available slot of the service', { reason: 'slot_unavailable' });
        }
        const ins = await tx.execute(sql`
          INSERT INTO service_bookings (offer_id, client_id, starts_at, ends_at, note, amount_minor, currency)
          VALUES (${offerId}::uuid, ${userId}::uuid, ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, ${req.note ?? null},
            ${cur.price_kind === 'fixed' ? cur.price_minor : null}, ${cur.price_kind === 'fixed' ? cur.currency : null})
          RETURNING id`);
        const id = (ins.rows[0] as { id: string }).id;
        await this.addEvent(tx, id, null, 'requested', 'client', userId, null);
        return id;
      });
    } catch (err) {
      if (pgErrorOf(err).constraint === 'service_bookings_slot_unique') throw AppError.conflict('This slot is already booked', { reason: 'slot_taken' });
      throw err;
    }
    const row = (await this.load(this.db, bookingId))!;
    await this.notifyProvider(row, 'Nouvelle demande de réservation.');
    return this.detail(row);
  }

  // ---- reads ------------------------------------------------------------------------------------

  async get(userId: string, id: string): Promise<BookingDetail> {
    const row = await this.loadFor(userId, id);
    return this.detail(row.row);
  }

  listAsClient(userId: string, q: BookingListQuery): Promise<BookingList> {
    return this.list(sql`b.client_id = ${userId}::uuid`, q);
  }

  listAsIndividual(userId: string, q: BookingListQuery): Promise<BookingList> {
    return this.list(sql`s.provider_id = ${userId}::uuid`, q);
  }

  listAsOrg(orgId: string, q: BookingListQuery): Promise<BookingList> {
    return this.list(sql`s.org_id = ${orgId}::uuid`, q);
  }

  private async list(scope: SQL, q: BookingListQuery): Promise<BookingList> {
    const cursor = q.cursor ? decodeCursor(q.cursor, 'time') : null;
    const res = await this.db.execute(sql`
      ${BOOKING_SELECT}
      WHERE ${scope} ${q.status ? sql`AND b.status = ${q.status}` : sql``}
        ${cursor ? sql`AND (b.created_at, b.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows as unknown as BookingRow[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: page.map(toBooking), nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  // ---- actions ----------------------------------------------------------------------------------

  confirm(userId: string, id: string): Promise<BookingDetail> {
    return this.act(userId, id, 'confirm');
  }
  decline(userId: string, id: string, reason?: string): Promise<BookingDetail> {
    return this.act(userId, id, 'decline', { reason });
  }
  cancel(userId: string, id: string, reason?: string): Promise<BookingDetail> {
    return this.act(userId, id, 'cancel', { reason });
  }
  complete(userId: string, id: string): Promise<BookingDetail> {
    return this.act(userId, id, 'complete');
  }
  noShow(userId: string, id: string): Promise<BookingDetail> {
    return this.act(userId, id, 'no_show');
  }
  proposeQuote(userId: string, id: string, q: ProposeQuoteRequest): Promise<BookingDetail> {
    return this.act(userId, id, 'quote', { quote: q });
  }
  acceptQuote(userId: string, id: string): Promise<BookingDetail> {
    return this.act(userId, id, 'quote_accept');
  }
  declineQuote(userId: string, id: string): Promise<BookingDetail> {
    return this.act(userId, id, 'quote_decline');
  }

  private async act(userId: string, id: string, action: Action, input: { reason?: string; quote?: ProposeQuoteRequest } = {}): Promise<BookingDetail> {
    if (!UUID_RE.test(id)) throw bookingNotFound();
    const notify: { to: Side; body: string }[] = [];
    const bookingId = await this.db.transaction(async (tx) => {
      const lock = await tx.execute(sql`SELECT 1 FROM service_bookings WHERE id = ${id}::uuid FOR UPDATE`);
      if (lock.rows.length === 0) throw bookingNotFound();
      const row = (await this.load(tx, id))!;
      const side = await this.sideOf(userId, row);
      const now = new Date();
      const providerOnly: Action[] = ['confirm', 'decline', 'complete', 'no_show', 'quote'];
      if (providerOnly.includes(action) && side !== 'provider') throw AppError.forbidden();
      if ((action === 'quote_accept' || action === 'quote_decline') && side !== 'client') throw AppError.forbidden();

      let next: Booking['status'] = row.status;
      let quoteStatus = row.quote_status;
      let amount = row.amount_minor;
      let currency = row.currency;
      let note: string | null = input.reason ?? null;
      switch (action) {
        case 'confirm':
          if (row.status !== 'requested') throw invalidTransition(row.status, action);
          if (row.price_kind === 'quote' && row.quote_status !== 'accepted') {
            throw AppError.conflict('The client has not accepted a quote yet', { reason: 'quote_not_accepted' });
          }
          next = 'confirmed';
          notify.push({ to: 'client', body: 'Votre réservation a été confirmée.' });
          break;
        case 'decline':
          if (row.status !== 'requested') throw invalidTransition(row.status, action);
          next = 'declined';
          notify.push({ to: 'client', body: 'Votre demande de réservation a été refusée.' });
          break;
        case 'cancel':
          if (row.status !== 'requested' && row.status !== 'confirmed') throw invalidTransition(row.status, action);
          if (side === 'client') {
            const limit = new Date(row.starts_at).getTime() - row.cancel_notice_hours * 3_600_000;
            if (now.getTime() > limit) {
              throw AppError.conflict('The free cancellation period has ended', { reason: 'cancellation_window_closed', noticeHours: row.cancel_notice_hours });
            }
          }
          next = 'cancelled';
          notify.push(side === 'client' ? { to: 'provider', body: 'Une réservation a été annulée.' } : { to: 'client', body: 'Votre réservation a été annulée par le prestataire.' });
          break;
        case 'complete':
        case 'no_show':
          if (row.status !== 'confirmed') throw invalidTransition(row.status, action);
          if (new Date(row.starts_at) > now) throw AppError.conflict('The appointment has not started yet', { reason: 'not_started' });
          next = action === 'complete' ? 'completed' : 'no_show';
          notify.push({ to: 'client', body: action === 'complete' ? 'Votre prestation est terminée. Vous pouvez laisser un avis.' : 'Votre réservation a été marquée comme non honorée.' });
          break;
        case 'quote':
          if (row.price_kind !== 'quote') throw AppError.conflict('This service has a fixed price', { reason: 'not_a_quote_service' });
          if (row.status !== 'requested' || row.quote_status === 'accepted') throw invalidTransition(row.status, action);
          quoteStatus = 'proposed';
          amount = input.quote!.amountMinor;
          currency = input.quote!.currency;
          note = 'quote_proposed';
          notify.push({ to: 'client', body: 'Un devis vous a été proposé.' });
          break;
        case 'quote_accept':
        case 'quote_decline':
          if (row.status !== 'requested' || row.quote_status !== 'proposed') throw invalidTransition(row.status, action);
          if (action === 'quote_accept') {
            quoteStatus = 'accepted';
            note = 'quote_accepted';
            notify.push({ to: 'provider', body: 'Le devis a été accepté.' });
          } else {
            quoteStatus = 'declined';
            next = 'cancelled';
            note = 'quote_declined';
            notify.push({ to: 'provider', body: 'Le devis a été refusé.' });
          }
          break;
      }
      await tx.execute(sql`
        UPDATE service_bookings SET status = ${next}, quote_status = ${quoteStatus}, amount_minor = ${amount}, currency = ${currency},
          status_changed_at = now(), status_changed_by = ${side}, updated_at = now()
        WHERE id = ${id}::uuid`);
      await this.addEvent(tx, id, row.status, next, side, userId, note);
      return id;
    });
    const row = (await this.load(this.db, bookingId))!;
    for (const n of notify) {
      if (n.to === 'client') await this.notifyUser(row.client_id, row.id, n.body);
      else await this.notifyProvider(row, n.body);
    }
    return this.detail(row);
  }

  // ---- reviews ----------------------------------------------------------------------------------

  async review(userId: string, bookingId: string, req: CreateServiceReviewRequest): Promise<ServiceReview> {
    const { row, side } = await this.loadFor(userId, bookingId);
    if (side !== 'client') throw AppError.forbidden('Only the client of a completed booking can review it');
    if (row.status !== 'completed') {
      throw AppError.conflict('A booking can only be reviewed once it is completed', { reason: 'booking_not_completed' });
    }
    let id: string;
    try {
      const res = await this.db.execute(sql`
        INSERT INTO service_reviews (booking_id, offer_id, client_id, rating, body)
        VALUES (${bookingId}::uuid, ${row.offer_id}::uuid, ${userId}::uuid, ${req.rating}, ${req.body ?? null}) RETURNING id`);
      id = (res.rows[0] as { id: string }).id;
    } catch (err) {
      if (pgErrorOf(err).constraint === 'service_reviews_booking_id_key') throw AppError.conflict('You already reviewed this booking', { reason: 'already_reviewed' });
      throw err;
    }
    await this.notifyProvider(row, 'Un client a laissé un avis.');
    return (await this.readReviews(sql`r.id = ${id}::uuid`, 1, null)).items[0]!;
  }

  async listReviews(viewerId: string, offerId: string, q: PageQuery): Promise<ServiceReviewList> {
    if (!UUID_RE.test(offerId) || !(await this.services.loadVisible(viewerId, offerId))) throw serviceNotFound();
    const page = await this.readReviews(sql`r.offer_id = ${offerId}::uuid AND (NOT r.hidden OR r.client_id = ${viewerId}::uuid)`, q.limit, q.cursor ?? null);
    const stats = await this.db.execute(sql`
      SELECT rating, count(*)::int AS n FROM service_reviews WHERE offer_id = ${offerId}::uuid AND NOT hidden GROUP BY rating`);
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let count = 0;
    let sum = 0;
    for (const s of stats.rows as { rating: number; n: number }[]) {
      distribution[String(s.rating) as keyof typeof distribution] = s.n;
      count += s.n;
      sum += s.rating * s.n;
    }
    return { ...page, summary: { ratingCount: count, averageRating: count > 0 ? Math.round((sum / count) * 100) / 100 : null, distribution } };
  }

  /** Reply of the provider side (one per review, replaced by a new reply). */
  async reply(userId: string, reviewId: string, req: ServiceReviewReplyRequest): Promise<ServiceReview> {
    if (!UUID_RE.test(reviewId)) throw reviewNotFound();
    const res = await this.db.execute(sql`
      SELECT r.client_id, r.booking_id, s.org_id, s.provider_id FROM service_reviews r JOIN service_offers s ON s.id = r.offer_id
      WHERE r.id = ${reviewId}::uuid AND NOT r.hidden`);
    const r = res.rows[0] as { client_id: string; booking_id: string; org_id: string | null; provider_id: string | null } | undefined;
    if (!r) throw reviewNotFound();
    if (r.provider_id !== userId) {
      const role = r.org_id ? await this.memberRole(r.org_id, userId) : null;
      if (!role) throw reviewNotFound();
      if (!roleHasPermission(role, 'catalog.manage')) throw AppError.forbidden();
    }
    await this.db.execute(sql`
      UPDATE service_reviews SET reply_body = ${req.body}, reply_by = ${userId}::uuid, replied_at = now(), updated_at = now() WHERE id = ${reviewId}::uuid`);
    await this.notifyUser(r.client_id, r.booking_id, 'Le prestataire a répondu à votre avis.');
    return (await this.readReviews(sql`r.id = ${reviewId}::uuid`, 1, null)).items[0]!;
  }

  private async readReviews(where: SQL, limit: number, cursorRaw: string | null): Promise<Omit<ServiceReviewList, 'summary'>> {
    const cursor = cursorRaw ? decodeCursor(cursorRaw, 'time') : null;
    const res = await this.db.execute(sql`
      SELECT r.id, r.offer_id, r.booking_id, r.rating, r.body, r.reply_body, r.replied_at, r.created_at, r.created_at::text AS ts,
             u.id AS user_id, u.handle::text AS handle, u.display_name, u.avatar_url
      FROM service_reviews r JOIN users u ON u.id = r.client_id
      WHERE ${where} ${cursor ? sql`AND (r.created_at, r.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows as {
      id: string; offer_id: string; booking_id: string; rating: number; body: string | null; reply_body: string | null;
      replied_at: string | Date | null; created_at: string | Date; ts: string; user_id: string; handle: string; display_name: string; avatar_url: string | null;
    }[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        offerId: r.offer_id,
        bookingId: r.booking_id,
        rating: r.rating,
        body: r.body,
        author: { userId: r.user_id, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url },
        verifiedBooking: true as const,
        reply: r.reply_body && r.replied_at ? { body: r.reply_body, repliedAt: iso(r.replied_at) } : null,
        createdAt: iso(r.created_at),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  // ---- internals --------------------------------------------------------------------------------

  private async load(db: Pick<Db, 'execute'>, id: string): Promise<BookingRow | null> {
    const res = await db.execute(sql`${BOOKING_SELECT} WHERE b.id = ${id}::uuid`);
    return (res.rows[0] as unknown as BookingRow | undefined) ?? null;
  }

  private async loadFor(userId: string, id: string): Promise<{ row: BookingRow; side: Side }> {
    if (!UUID_RE.test(id)) throw bookingNotFound();
    const row = await this.load(this.db, id);
    if (!row) throw bookingNotFound();
    return { row, side: await this.sideOf(userId, row) };
  }

  /** Client, provider (individual or member holding `catalog.manage`); an unrelated user gets a 404, a member without the permission a 403. */
  private async sideOf(userId: string, row: BookingRow): Promise<Side> {
    if (row.client_id === userId) return 'client';
    if (row.provider_id === userId) return 'provider';
    const role = row.org_id ? await this.memberRole(row.org_id, userId) : null;
    if (!role) throw bookingNotFound();
    if (!roleHasPermission(role, 'catalog.manage')) throw AppError.forbidden();
    return 'provider';
  }

  private async memberRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const res = await this.db.execute(sql`SELECT role FROM org_members WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND status = 'active'`);
    return (res.rows[0] as { role: OrgRole } | undefined)?.role ?? null;
  }

  private async detail(row: BookingRow): Promise<BookingDetail> {
    const ev = await this.db.execute(sql`
      SELECT from_status, status, actor_kind, actor_user_id, note, created_at FROM service_booking_events
      WHERE booking_id = ${row.id}::uuid ORDER BY created_at, id`);
    return {
      ...toBooking(row),
      events: (ev.rows as { from_status: string | null; status: string; actor_kind: 'client' | 'provider' | 'system'; actor_user_id: string | null; note: string | null; created_at: string | Date }[]).map(
        (e) => ({ fromStatus: e.from_status, status: e.status, actorKind: e.actor_kind, actorUserId: e.actor_user_id, note: e.note, createdAt: iso(e.created_at) }),
      ),
    };
  }

  private async addEvent(tx: Pick<Db, 'execute'>, bookingId: string, from: string | null, status: string, kind: 'client' | 'provider' | 'system', actor: string | null, note: string | null): Promise<void> {
    await tx.execute(sql`
      INSERT INTO service_booking_events (booking_id, from_status, status, actor_kind, actor_user_id, note)
      VALUES (${bookingId}::uuid, ${from}, ${status}, ${kind}, ${actor}::uuid, ${note})`);
  }

  /** Generic texts: no name, address, amount or note ever goes into a notification. */
  private notifyUser(userId: string, bookingId: string, body: string): Promise<void> {
    return this.notifications.notify({ userId, category: 'booking', title: 'Réservation', body, data: { bookingId } });
  }

  private async notifyProvider(row: BookingRow, body: string): Promise<void> {
    let recipients: string[];
    if (row.provider_id) recipients = [row.provider_id];
    else {
      const res = await this.db.execute(sql`SELECT user_id, role FROM org_members WHERE org_id = ${row.org_id}::uuid AND status = 'active'`);
      recipients = (res.rows as { user_id: string; role: OrgRole }[]).filter((m) => roleHasPermission(m.role, 'catalog.manage')).map((m) => m.user_id);
    }
    await this.notifications.notifyMany(
      recipients.filter((u) => u !== row.client_id).map((userId) => ({ userId, category: 'booking' as const, title: 'Réservation', body, data: { bookingId: row.id } })),
    );
  }
}
