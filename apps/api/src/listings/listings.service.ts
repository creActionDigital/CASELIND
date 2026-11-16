import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ErrorCodes,
  type CreateListingAlertRequest,
  type CreateListingRequest,
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
