import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ErrorCodes,
  type CreateListingAlertRequest,
  type CreateListingRequest,
  type CreateVisitRequest,
  type ListingVisit,
  type ListingVisitList,
  type CompareListingsResponse,
  type CreateOfferRequest,
  type ListingOffer,
  type ListingOfferList,
  MAX_OPEN_OFFERS,
  MIN_OFFER_PERCENT,
  MAX_PENDING_VISITS,
  MAX_VISIT_DAYS_AHEAD,
  type ListingAlert,
  type ListingAlertList,
  MAX_LISTING_ALERTS,
  type Listing,
  type ListingList,
  type ListingListQuery,
  type UpdateListingRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// shortcut: fixed cap per owner against ad flooding, make it an env setting when operations need to tune it.
const MAX_ACTIVE_PER_OWNER = 20;

const notFound = () => AppError.notFound('Listing not found');
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);

type Row = {
  id: string;
  kind: Listing['kind'];
  title: string;
  description: string;
  price_minor: string | null;
  currency: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  status: 'active' | 'closed';
  created_at: Date;
  owner_id: string;
  owner_name: string;
  owner_handle: string;
  media_ids: string[] | null;
};

/** Visible to the viewer: active, not hidden by moderation, and no block either way with the owner. The owner always sees their own. */
const visibleSql = (viewerId: string): SQL => sql`(
  l.owner_id = ${viewerId}::uuid
  OR (l.status = 'active' AND NOT l.hidden AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = l.owner_id) OR (b.blocker_id = l.owner_id AND b.blocked_id = ${viewerId}::uuid))))`;

const encodeCursor = (createdAt: Date, id: string) => Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) {
      return { at: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Classified ads: property, vehicles, used goods, lost and found. Contact goes through messaging; nothing is paid or verified here. */
@Injectable()
export class ListingsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly moderation: ModerationRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.moderation.register('listing', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM listings l WHERE l.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ owner_id: string }>(sql`SELECT owner_id FROM listings WHERE id = ${id}::uuid`);
        return res.rows[0]?.owner_id ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE listings SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  async create(userId: string, body: CreateListingRequest, meta: RequestMeta): Promise<Listing> {
    await this.checkMedia(userId, body.mediaIds);
    const id = await this.db.transaction(async (tx) => {
      // The owner row serialises concurrent creates so the cap cannot be raced.
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listings WHERE owner_id = ${userId}::uuid AND status = 'active'`);
      if ((n.rows[0]?.n ?? 0) >= MAX_ACTIVE_PER_OWNER) {
        throw AppError.conflict(`At most ${MAX_ACTIVE_PER_OWNER} active listings`, { reason: 'listing_limit', max: MAX_ACTIVE_PER_OWNER });
      }
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO listings (owner_id, kind, title, description, price_minor, currency, city, latitude, longitude)
        VALUES (${userId}::uuid, ${body.kind}, ${body.title}, ${body.description}, ${body.priceMinor}, ${body.currency}, ${body.city}, ${body.latitude}, ${body.longitude})
        RETURNING id`);
      const listingId = res.rows[0]!.id;
      await this.setMedia(tx, listingId, body.mediaIds);
      await this.audit.record({ action: 'listing.created', actorUserId: userId, meta, metadata: { listingId, kind: body.kind } }, tx);
      return listingId;
    });
    await this.notifyAlerts(userId, id, body).catch(() => undefined); // best effort: the ad is already published
    return this.get(userId, id);
  }

  async update(userId: string, id: string, body: UpdateListingRequest, meta: RequestMeta): Promise<Listing> {
    const current = await this.get(userId, id);
    if (!current.mine) throw notFound();
    if (body.mediaIds) await this.checkMedia(userId, body.mediaIds);
    const priceMinor = body.priceMinor !== undefined ? body.priceMinor : current.priceMinor;
    const currency = body.currency !== undefined ? body.currency : current.currency;
    if ((priceMinor === null) !== (currency === null)) throw invalid('currency', 'priceMinor and currency go together');
    if ((current.kind === 'lost' || current.kind === 'found') && priceMinor !== null) throw invalid('priceMinor', 'lost and found items have no price');
    const lat = body.latitude !== undefined ? body.latitude : current.latitude;
    const lng = body.longitude !== undefined ? body.longitude : current.longitude;
    if ((lat === null) !== (lng === null)) throw invalid('longitude', 'latitude and longitude go together');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE listings SET title = ${body.title ?? current.title}, description = ${body.description ?? current.description},
          price_minor = ${priceMinor}, currency = ${currency}, city = ${body.city ?? current.city},
          latitude = ${lat}, longitude = ${lng}, updated_at = now()
        WHERE id = ${id}::uuid`);
      if (body.mediaIds) await this.setMedia(tx, id, body.mediaIds);
      await this.audit.record({ action: 'listing.updated', actorUserId: userId, meta, metadata: { listingId: id } }, tx);
    });
    return this.get(userId, id);
  }

  /** Owner marks the ad done (rented, sold, found...). Idempotent. */
  async close(userId: string, id: string, meta: RequestMeta): Promise<Listing> {
    const current = await this.get(userId, id);
    if (!current.mine) throw notFound();
    if (current.status === 'active') {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE listings SET status = 'closed', updated_at = now() WHERE id = ${id}::uuid`);
        await this.audit.record({ action: 'listing.closed', actorUserId: userId, meta, metadata: { listingId: id } }, tx);
      });
    }
    return this.get(userId, id);
  }

  async get(viewerId: string, id: string): Promise<Listing> {
    if (!UUID_RE.test(id)) throw notFound();
    const res = await this.db.execute<Row>(sql`${this.base()} WHERE l.id = ${id}::uuid AND ${visibleSql(viewerId)}`);
    const row = res.rows[0];
    if (!row) throw notFound();
    return toListing(row, viewerId);
  }

  async list(viewerId: string, q: ListingListQuery): Promise<ListingList> {
    const f: SQL[] = [sql`l.status = 'active'`, sql`NOT l.hidden`, visibleSql(viewerId)];
    if (q.kind) f.push(sql`l.kind = ${q.kind}`);
    if (q.city) f.push(sql`l.city ILIKE ${escapeLike(q.city)}`);
    if (q.q) f.push(sql`(l.title ILIKE ${'%' + escapeLike(q.q) + '%'} OR l.description ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    if (q.currency) f.push(sql`l.currency = ${q.currency}`);
    if (q.minPriceMinor !== undefined) f.push(sql`l.price_minor >= ${q.minPriceMinor}`);
    if (q.maxPriceMinor !== undefined) f.push(sql`l.price_minor <= ${q.maxPriceMinor}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(l.created_at, l.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(viewerId, f, q.limit);
  }

  /** The caller's own ads, active and closed. */
  async mine(userId: string, q: { limit: number; cursor?: string }): Promise<ListingList> {
    const f: SQL[] = [sql`l.owner_id = ${userId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(l.created_at, l.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(userId, f, q.limit);
  }

  // ---- Alerts (private to their owner) ----------------------------------------------------------

  private toAlert = (r: { id: string; q: string | null; city: string | null; kind: ListingAlert['kind']; created_at: Date }): ListingAlert => ({
    id: r.id,
    q: r.q,
    city: r.city,
    kind: r.kind,
    createdAt: new Date(r.created_at).toISOString(),
  });

  async listAlerts(userId: string): Promise<ListingAlertList> {
    const res = await this.db.execute<{ id: string; q: string | null; city: string | null; kind: ListingAlert['kind']; created_at: Date }>(
      sql`SELECT id, q, city, kind, created_at FROM listing_alerts WHERE user_id = ${userId}::uuid ORDER BY created_at, id`,
    );
    return { items: res.rows.map(this.toAlert) };
  }

  async createAlert(userId: string, body: CreateListingAlertRequest, meta: RequestMeta): Promise<ListingAlert> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`); // serialises the quota check
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listing_alerts WHERE user_id = ${userId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= MAX_LISTING_ALERTS) throw AppError.conflict('Listing alert limit reached', { reason: 'alert_limit' });
      const res = await tx.execute<{ id: string; q: string | null; city: string | null; kind: ListingAlert['kind']; created_at: Date }>(sql`
        INSERT INTO listing_alerts (user_id, q, city, kind) VALUES (${userId}::uuid, ${body.q ?? null}, ${body.city ?? null}, ${body.kind ?? null})
        RETURNING id, q, city, kind, created_at`);
      const row = res.rows[0]!;
      await this.audit.record({ action: 'listing.alert_created', actorUserId: userId, meta, metadata: { alertId: row.id } }, tx);
      return this.toAlert(row);
    });
  }

  /** Idempotent; only the owner can delete (anything else is a no-op 204). */
  async deleteAlert(userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`DELETE FROM listing_alerts WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
      if (res.rowCount) await this.audit.record({ action: 'listing.alert_deleted', actorUserId: userId, meta, metadata: { alertId: id } }, tx);
    });
  }

  /** Same filter as GET /listings (kind, city, text in title or description). Generic title: never the ad's content. Not the author, no block either way. */
  private async notifyAlerts(ownerId: string, listingId: string, body: CreateListingRequest): Promise<void> {
    const res = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT a.user_id FROM listing_alerts a
      WHERE a.user_id <> ${ownerId}::uuid
        AND (a.kind IS NULL OR a.kind = ${body.kind})
        AND (a.city IS NULL OR lower(a.city) = lower(${body.city}))
        AND (a.q IS NULL OR position(lower(a.q) in lower(${body.title} || ' ' || ${body.description})) > 0)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = a.user_id AND b.blocked_id = ${ownerId}::uuid) OR (b.blocker_id = ${ownerId}::uuid AND b.blocked_id = a.user_id))
        LIMIT 500`); // shortcut: 500 recipients per ad, no paging; upgrade to a batched job if alerts exceed that
    await this.notifications.notifyMany(res.rows.map((r) => ({ userId: r.user_id, category: 'commerce' as const, title: 'Nouvelle annonce correspondant à votre alerte', body: 'Ouvrez l’annonce pour la consulter.', data: { listingId } })));
  }

  // ---- Visit appointments (lot 15c) -------------------------------------------------------------

  private async visitRows(viewerId: string, where: SQL, tail: SQL = sql``): Promise<VisitRow[]> {
    const res = await this.db.execute<VisitRow>(sql`
      SELECT v.id, v.listing_id, l.title AS listing_title, v.status, v.scheduled_at, v.message, v.place, v.visitor_id, l.owner_id, v.created_at,
        o.id AS other_id, o.display_name AS other_name, o.handle::text AS other_handle
      FROM listing_visits v JOIN listings l ON l.id = v.listing_id
      JOIN users o ON o.id = CASE WHEN v.visitor_id = ${viewerId}::uuid THEN l.owner_id ELSE v.visitor_id END
      WHERE (v.visitor_id = ${viewerId}::uuid OR l.owner_id = ${viewerId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = v.visitor_id AND b.blocked_id = l.owner_id) OR (b.blocker_id = l.owner_id AND b.blocked_id = v.visitor_id))
        AND ${where} ${tail}`);
    return res.rows;
  }

  async requestVisit(userId: string, listingId: string, body: CreateVisitRequest, meta: RequestMeta): Promise<ListingVisit> {
    const at = new Date(body.scheduledAt);
    const now = Date.now();
    if (at.getTime() <= now || at.getTime() > now + MAX_VISIT_DAYS_AHEAD * 86_400_000) throw invalid('scheduledAt', `must be in the future, within ${MAX_VISIT_DAYS_AHEAD} days`);
    const listing = await this.get(userId, listingId); // 404 when hidden, closed for others, or blocked
    if (listing.mine) throw invalid('listingId', 'you cannot visit your own listing');
    if (listing.status !== 'active') throw notFound();
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`); // serialises the quotas
      const open = await tx.execute(sql`SELECT 1 FROM listing_visits WHERE listing_id = ${listingId}::uuid AND visitor_id = ${userId}::uuid AND status IN ('requested', 'confirmed')`);
      if (open.rows.length > 0) throw AppError.conflict('A visit is already open for this listing', { reason: 'visit_exists' });
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listing_visits WHERE visitor_id = ${userId}::uuid AND status = 'requested'`);
      if ((n.rows[0]?.n ?? 0) >= MAX_PENDING_VISITS) throw AppError.conflict('Too many pending visit requests', { reason: 'visit_limit', max: MAX_PENDING_VISITS });
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO listing_visits (listing_id, visitor_id, scheduled_at, message) VALUES (${listingId}::uuid, ${userId}::uuid, ${at.toISOString()}::timestamptz, ${body.message}) RETURNING id`);
      const visitId = res.rows[0]!.id;
      await this.audit.record({ action: 'listing.visit_requested', actorUserId: userId, meta, metadata: { visitId, listingId } }, tx);
      return visitId;
    });
    await this.notifications.notify({ userId: listing.owner.id, category: 'commerce', title: 'Nouvelle demande de visite', body: 'Ouvrez Mes visites pour répondre.', data: { visitId: id } }).catch(() => undefined);
    return this.getVisit(userId, id);
  }

  async listVisits(userId: string): Promise<ListingVisitList> {
    const rows = await this.visitRows(userId, sql`TRUE`, sql`ORDER BY v.scheduled_at DESC, v.id DESC LIMIT 100`); // shortcut: 100 most recent, no paging
    return { items: rows.map((r) => toVisit(r, userId)) };
  }

  async getVisit(userId: string, id: string): Promise<ListingVisit> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = (await this.visitRows(userId, sql`v.id = ${id}::uuid`))[0];
    if (!row) throw AppError.notFound('Visit not found');
    return toVisit(row, userId);
  }

  /** Owner confirms (optionally with a precise place) or declines a pending request; either party cancels an open one (the visitor until 1 h before). */
  async answerVisit(userId: string, id: string, action: 'confirm' | 'decline' | 'cancel', place: string | undefined, meta: RequestMeta): Promise<ListingVisit> {
    const v = await this.getVisit(userId, id);
    const next = { confirm: 'confirmed', decline: 'declined', cancel: 'cancelled' }[action] as ListingVisit['status'];
    if (action === 'cancel' ? v.status !== 'requested' && v.status !== 'confirmed' : v.status !== 'requested') throw AppError.conflict('Visit cannot change from its current status', { reason: 'bad_status' });
    if (action !== 'cancel' && v.role !== 'owner') throw AppError.notFound('Visit not found');
    if (action !== 'cancel') {
      const live = await this.db.execute(sql`SELECT 1 FROM listings WHERE id = ${v.listingId}::uuid AND status = 'active' AND NOT hidden`);
      if (live.rows.length === 0) throw AppError.conflict('The listing is no longer active', { reason: 'listing_inactive' });
    }
    const startsIn = new Date(v.scheduledAt).getTime() - Date.now();
    if (action === 'confirm' && startsIn <= 0) throw AppError.conflict('The requested time has passed', { reason: 'past' });
    if (action === 'cancel' && v.role === 'visitor' && startsIn < 3_600_000) throw AppError.conflict('A visit can only be cancelled up to 1 hour before', { reason: 'too_late' });
    await this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE listing_visits SET status = ${next}, place = ${action === 'confirm' ? (place ?? null) : null}, updated_at = now()
        WHERE id = ${id}::uuid AND status = ${v.status}`);
      if (!res.rowCount) throw AppError.conflict('Visit cannot change from its current status', { reason: 'bad_status' });
      await this.audit.record({ action: `listing.visit_${next}` as 'listing.visit_confirmed', actorUserId: userId, meta, metadata: { visitId: id, listingId: v.listingId } }, tx);
    });
    const title = { confirmed: 'Votre demande de visite a été confirmée', declined: 'Votre demande de visite a été refusée', cancelled: 'Une visite a été annulée' }[next as 'confirmed'];
    await this.notifications.notify({ userId: v.other.id, category: 'commerce', title, body: 'Ouvrez Mes visites pour les détails.', data: { visitId: id } }).catch(() => undefined);
    return this.getVisit(userId, id);
  }

  // ---- Guided negotiation (lot 15d): indicative only, nothing is sold or paid --------------------

  private async offerRows(viewerId: string, where: SQL, tail: SQL = sql``): Promise<OfferRow[]> {
    const res = await this.db.execute<OfferRow>(sql`
      SELECT o.id, o.listing_id, l.title AS listing_title, l.price_minor AS asking_minor, o.status, o.offer_minor, o.counter_minor, o.currency, o.message, o.buyer_id, l.owner_id, o.created_at,
        u.id AS other_id, u.display_name AS other_name, u.handle::text AS other_handle
      FROM listing_offers o JOIN listings l ON l.id = o.listing_id
      JOIN users u ON u.id = CASE WHEN o.buyer_id = ${viewerId}::uuid THEN l.owner_id ELSE o.buyer_id END
      WHERE (o.buyer_id = ${viewerId}::uuid OR l.owner_id = ${viewerId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = o.buyer_id AND b.blocked_id = l.owner_id) OR (b.blocker_id = l.owner_id AND b.blocked_id = o.buyer_id))
        AND ${where} ${tail}`);
    return res.rows;
  }

  async makeOffer(userId: string, listingId: string, body: CreateOfferRequest, meta: RequestMeta): Promise<ListingOffer> {
    const listing = await this.get(userId, listingId); // 404 when hidden or blocked
    if (listing.mine) throw invalid('listingId', 'you cannot make an offer on your own listing');
    if (listing.status !== 'active') throw notFound();
    if (listing.priceMinor === null || listing.currency === null) throw invalid('listingId', 'this listing has no fixed price');
    const min = Math.ceil((listing.priceMinor * MIN_OFFER_PERCENT) / 100);
    if (body.amountMinor < min || body.amountMinor > listing.priceMinor) throw invalid('amountMinor', `must be between ${min} and ${listing.priceMinor}`);
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`); // serialises the quotas
      const open = await tx.execute(sql`SELECT 1 FROM listing_offers WHERE listing_id = ${listingId}::uuid AND buyer_id = ${userId}::uuid AND status IN ('offered', 'countered')`);
      if (open.rows.length > 0) throw AppError.conflict('A negotiation is already open for this listing', { reason: 'offer_exists' });
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM listing_offers WHERE buyer_id = ${userId}::uuid AND status IN ('offered', 'countered')`);
      if ((n.rows[0]?.n ?? 0) >= MAX_OPEN_OFFERS) throw AppError.conflict('Too many open negotiations', { reason: 'offer_limit', max: MAX_OPEN_OFFERS });
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO listing_offers (listing_id, buyer_id, offer_minor, currency, message)
        VALUES (${listingId}::uuid, ${userId}::uuid, ${body.amountMinor}, ${listing.currency}, ${body.message}) RETURNING id`);
      const offerId = res.rows[0]!.id;
      await this.audit.record({ action: 'listing.offer_offered', actorUserId: userId, meta, metadata: { offerId, listingId } }, tx);
      return offerId;
    });
    await this.notifications.notify({ userId: listing.owner.id, category: 'commerce', title: 'Nouvelle offre sur votre annonce', body: 'Ouvrez Mes offres pour répondre.', data: { offerId: id } }).catch(() => undefined);
    return this.getOffer(userId, id);
  }

  async listOffers(userId: string): Promise<ListingOfferList> {
    const rows = await this.offerRows(userId, sql`TRUE`, sql`ORDER BY o.created_at DESC, o.id DESC LIMIT 100`); // shortcut: 100 most recent, no paging
    return { items: rows.map((r) => toOffer(r, userId)) };
  }

  async getOffer(userId: string, id: string): Promise<ListingOffer> {
    if (!UUID_RE.test(id)) throw notFound();
    const row = (await this.offerRows(userId, sql`o.id = ${id}::uuid`))[0];
    if (!row) throw AppError.notFound('Offer not found');
    return toOffer(row, userId);
  }

  /**
   * The owner answers an offer (accept, decline, counter once); the buyer answers a counter-offer (accept, decline) or cancels any open negotiation.
   * Answering needs a live ad (409 listing_inactive); cancelling is always possible.
   */
  async answerOffer(userId: string, id: string, action: 'accept' | 'decline' | 'counter' | 'cancel', amountMinor: number | undefined, meta: RequestMeta): Promise<ListingOffer> {
    const o = await this.getOffer(userId, id);
    if (o.status !== 'offered' && o.status !== 'countered') throw AppError.conflict('Offer cannot change from its current status', { reason: 'bad_status' });
    if (action === 'cancel') {
      if (o.role !== 'buyer') throw AppError.notFound('Offer not found');
    } else {
      const turn = o.status === 'offered' ? 'owner' : 'buyer';
      if (o.role !== turn || (action === 'counter' && o.status !== 'offered')) throw AppError.conflict('It is not your turn to answer', { reason: 'not_your_turn' });
      const live = await this.db.execute(sql`SELECT 1 FROM listings WHERE id = ${o.listingId}::uuid AND status = 'active' AND NOT hidden`);
      if (live.rows.length === 0) throw AppError.conflict('The listing is no longer active', { reason: 'listing_inactive' });
    }
    if (action === 'counter' && (amountMinor === undefined || amountMinor <= o.offerMinor || o.askingMinor === null || amountMinor > o.askingMinor)) {
      throw invalid('amountMinor', 'must be above the offer and not above the asking price');
    }
    const next = ({ accept: 'accepted', decline: 'declined', counter: 'countered', cancel: 'cancelled' } as const)[action];
    await this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE listing_offers SET status = ${next}, counter_minor = ${action === 'counter' ? amountMinor! : o.counterMinor}, updated_at = now()
        WHERE id = ${id}::uuid AND status = ${o.status}`);
      if (!res.rowCount) throw AppError.conflict('Offer cannot change from its current status', { reason: 'bad_status' });
      await this.audit.record({ action: `listing.offer_${next}` as 'listing.offer_accepted', actorUserId: userId, meta, metadata: { offerId: id, listingId: o.listingId } }, tx);
    });
    const title = { accepted: 'Une offre a été acceptée', declined: 'Une offre a été refusée', countered: 'Vous avez reçu une contre-offre', cancelled: 'Une offre a été annulée' }[next];
    await this.notifications.notify({ userId: o.other.id, category: 'commerce', title, body: 'Ouvrez Mes offres pour les détails.', data: { offerId: id } }).catch(() => undefined);
    return this.getOffer(userId, id);
  }

  // ---- Vehicle comparison (lot 15d) -------------------------------------------------------------

  /** 2 to 3 distinct ids; every ad must be an active, visible vehicle ad, otherwise 404 (no hint about which). */
  async compare(viewerId: string, idsParam: string): Promise<CompareListingsResponse> {
    const ids = idsParam.split(',').map((s) => s.trim().toLowerCase());
    if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length || !ids.every((i) => UUID_RE.test(i))) throw invalid('ids', 'give 2 or 3 distinct listing ids');
    const res = await this.db.execute<Row>(sql`
      ${this.base()} WHERE l.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND l.kind = 'vehicle' AND l.status = 'active' AND NOT l.hidden AND ${visibleSql(viewerId)}`);
    if (res.rows.length !== ids.length) throw notFound();
    const byId = new Map(res.rows.map((r) => [r.id, r]));
    return { items: ids.map((i) => toListing(byId.get(i)!, viewerId)) };
  }

  private async page(viewerId: string, filters: SQL[], limit: number): Promise<ListingList> {
    const res = await this.db.execute<Row>(sql`
      ${this.base()} WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => toListing(r, viewerId)), nextCursor: res.rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null };
  }

  private base(): SQL {
    return sql`
      SELECT l.id, l.kind, l.title, l.description, l.price_minor, l.currency, l.city, l.latitude, l.longitude, l.status, l.created_at,
        u.id AS owner_id, u.display_name AS owner_name, u.handle::text AS owner_handle,
        (SELECT array_agg(m.media_id ORDER BY m.position) FROM listing_media m WHERE m.listing_id = l.id) AS media_ids
      FROM listings l JOIN users u ON u.id = l.owner_id`;
  }

  /** Photos must be the caller's own ready uploads made for listings. */
  private async checkMedia(userId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    if (new Set(mediaIds).size !== mediaIds.length) throw invalid('mediaIds', 'duplicate media');
    const res = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM media_assets
      WHERE id IN (${sql.join(mediaIds.map((m) => sql`${m}::uuid`), sql`, `)}) AND owner_user_id = ${userId}::uuid AND purpose = 'listing' AND status = 'ready'`);
    if ((res.rows[0]?.n ?? 0) !== mediaIds.length) throw invalid('mediaIds', 'must be your own ready uploads with purpose "listing"');
  }

  private async setMedia(tx: Pick<Db, 'execute'>, listingId: string, mediaIds: string[]): Promise<void> {
    await tx.execute(sql`DELETE FROM listing_media WHERE listing_id = ${listingId}::uuid`);
    for (const [position, mediaId] of mediaIds.entries()) {
      await tx.execute(sql`INSERT INTO listing_media (listing_id, media_id, position) VALUES (${listingId}::uuid, ${mediaId}::uuid, ${position})`);
    }
  }
}

function toListing(r: Row, viewerId: string): Listing {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    priceMinor: r.price_minor === null ? null : Number(r.price_minor),
    currency: r.currency,
    city: r.city,
    latitude: r.latitude,
    longitude: r.longitude,
    status: r.status,
    mediaIds: r.media_ids ?? [],
    owner: { id: r.owner_id, displayName: r.owner_name, handle: r.owner_handle },
    mine: r.owner_id === viewerId,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

type VisitRow = {
  id: string;
  listing_id: string;
  listing_title: string;
  status: ListingVisit['status'];
  scheduled_at: Date;
  message: string;
  place: string | null;
  visitor_id: string;
  owner_id: string;
  created_at: Date;
  other_id: string;
  other_name: string;
  other_handle: string;
};

type OfferRow = {
  id: string;
  listing_id: string;
  listing_title: string;
  asking_minor: string | null;
  status: ListingOffer['status'];
  offer_minor: string;
  counter_minor: string | null;
  currency: string;
  message: string;
  buyer_id: string;
  owner_id: string;
  created_at: Date;
  other_id: string;
  other_name: string;
  other_handle: string;
};

function toOffer(r: OfferRow, viewerId: string): ListingOffer {
  return {
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    status: r.status,
    offerMinor: Number(r.offer_minor),
    counterMinor: r.counter_minor === null ? null : Number(r.counter_minor),
    currency: r.currency,
    askingMinor: r.asking_minor === null ? null : Number(r.asking_minor),
    message: r.message,
    role: r.buyer_id === viewerId ? 'buyer' : 'owner',
    other: { id: r.other_id, displayName: r.other_name, handle: r.other_handle },
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toVisit(r: VisitRow, viewerId: string): ListingVisit {
  return {
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    status: r.status,
    scheduledAt: new Date(r.scheduled_at).toISOString(),
    message: r.message,
    place: r.status === 'confirmed' ? r.place : null, // the precise place is only given once confirmed
    role: r.visitor_id === viewerId ? 'visitor' : 'owner',
    other: { id: r.other_id, displayName: r.other_name, handle: r.other_handle },
    createdAt: new Date(r.created_at).toISOString(),
  };
}
