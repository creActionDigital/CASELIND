import { Inject, Injectable } from '@nestjs/common';
import type {
  Availability,
  CreateServiceOfferRequest,
  OwnServiceListQuery,
  ServiceCategoryList,
  ServiceDiscoveryQuery,
  ServiceOffer,
  ServiceOfferDetail,
  ServiceOfferList,
  ServiceProfile,
  ServiceProviderRef,
  SetAvailabilityRequest,
  SlotList,
  SlotsQuery,
  UpdateServiceOfferRequest,
  UpsertServiceProfileRequest,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { contentUrlOf } from '../media/media.service.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { boundingBox } from '../places/places.service.js';
import {
  claimProblem,
  computeSlots,
  decodeCursor,
  encodeCursor,
  type ExceptionRow,
  hhmmOf,
  MAX_SLOT_RANGE_DAYS,
  minutesOf,
  OFFER_COLUMNS,
  OFFER_FROM,
  type RuleRow,
  serviceVisibleSql,
  UUID_RE,
  uuidArray,
  validationError,
} from './services.shared.js';

const EARTH_RADIUS_KM = 6371.0088;

export const serviceNotFound = () => AppError.notFound('Service not found');

/** Who owns an offer: an organisation of kind "services" or an individual provider. */
export type OfferScope = { orgId: string; providerId?: undefined } | { providerId: string; orgId?: undefined };

interface OfferRow {
  id: string;
  org_id: string | null;
  provider_id: string | null;
  created_by: string | null;
  category_id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  hidden: boolean;
  price_kind: 'fixed' | 'quote';
  price_minor: string | number | null;
  currency: string | null;
  duration_min: number;
  cancel_notice_hours: number;
  city: string;
  lat: number;
  lng: number;
  radius_km: number;
  utc_offset_minutes: number;
  urgent_available: boolean;
  guarantee_note: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  ts: string;
  org_slug: string | null;
  org_name: string | null;
  org_verified: boolean | null;
  prov_name: string | null;
  prov_verified: boolean | null;
  prov_handle: string | null;
  rating_count: number;
  rating_avg: number | null;
  d?: number | null;
  d_text?: string | null;
}

const iso = (v: string | Date): string => new Date(v).toISOString();
const scopeSql = (scope: OfferScope): SQL => (scope.orgId ? sql`s.org_id = ${scope.orgId}::uuid` : sql`s.provider_id = ${scope.providerId}::uuid`);

export function providerRefOf(r: Pick<OfferRow, 'org_id' | 'org_slug' | 'org_name' | 'org_verified' | 'provider_id' | 'prov_name' | 'prov_verified' | 'prov_handle'>): ServiceProviderRef {
  const verified = r.org_id ? !!r.org_verified : !!r.prov_verified;
  return {
    kind: r.org_id ? 'org' : 'individual',
    orgId: r.org_id,
    orgSlug: r.org_slug,
    userId: r.provider_id,
    handle: r.prov_handle,
    name: (r.org_id ? r.org_name : r.prov_name) ?? '',
    verified,
    verificationLabel: verified ? 'vérifié' : 'non vérifié',
  };
}

/** Offer catalogue, individual provider profiles, availability, discovery and free slots. */
@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    moderation: ModerationRegistry,
  ) {
    moderation.register('service', {
      visibleTo: async (viewerId, id) => (UUID_RE.test(id) ? (await this.loadVisible(viewerId, id)) !== null : false),
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute(sql`SELECT coalesce(provider_id, created_by) AS a FROM service_offers WHERE id = ${id}::uuid`);
        return (res.rows[0] as { a: string | null } | undefined)?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE service_offers SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  async categories(): Promise<ServiceCategoryList> {
    const res = await this.db.execute(sql`SELECT id, slug, name FROM service_categories ORDER BY position, slug`);
    return { items: res.rows as { id: string; slug: string; name: string }[] };
  }

  // ---- individual provider profile ------------------------------------------------------------

  async getProfile(userId: string): Promise<ServiceProfile> {
    const p = await this.readProfile(userId);
    if (!p) throw AppError.notFound('Service profile not found');
    return p;
  }

  async upsertProfile(userId: string, body: UpsertServiceProfileRequest): Promise<ServiceProfile> {
    await this.db.execute(sql`
      INSERT INTO service_providers (user_id, display_name, bio, city, skills)
      VALUES (${userId}::uuid, ${body.displayName}, ${body.bio ?? null}, ${body.city ?? null}, ${sql`ARRAY[${sql.join(body.skills.map((s) => sql`${s}`), sql`, `)}]::text[]`})
      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, city = EXCLUDED.city,
        skills = EXCLUDED.skills, updated_at = now()`);
    return (await this.readProfile(userId))!;
  }

  private async readProfile(userId: string): Promise<ServiceProfile | null> {
    const res = await this.db.execute(sql`SELECT * FROM service_providers WHERE user_id = ${userId}::uuid`);
    const r = res.rows[0] as
      | { user_id: string; display_name: string; bio: string | null; city: string | null; skills: string[]; verification_status: string; created_at: string | Date }
      | undefined;
    if (!r) return null;
    const verified = r.verification_status === 'verified';
    return {
      userId: r.user_id,
      displayName: r.display_name,
      bio: r.bio,
      city: r.city,
      skills: r.skills,
      verified,
      verificationLabel: verified ? 'vérifié' : 'non vérifié',
      createdAt: iso(r.created_at),
    };
  }

  // ---- owner side -------------------------------------------------------------------------------

  async create(scope: OfferScope, actorId: string, body: CreateServiceOfferRequest, meta: RequestMeta): Promise<ServiceOfferDetail> {
    let lat = body.lat;
    let lng = body.lng;
    if (scope.orgId) {
      const res = await this.db.execute(sql`SELECT kind, lat, lng FROM organizations WHERE id = ${scope.orgId}::uuid`);
      const org = res.rows[0] as { kind: string; lat: number | null; lng: number | null } | undefined;
      if (!org) throw AppError.notFound('Organization not found');
      if (org.kind !== 'services') throw AppError.conflict('Only an organization of kind "services" can publish services', { reason: 'org_not_services' });
      if (lat === undefined || lng === undefined) {
        lat = org.lat ?? undefined;
        lng = org.lng ?? undefined;
      }
    } else if (!(await this.readProfile(scope.providerId!))) {
      throw AppError.conflict('Create your provider profile first', { reason: 'profile_required' });
    }
    if (lat === undefined || lng === undefined) throw validationError('lat', 'lat and lng are required (the organization has no location)');
    this.checkCurrency(body.currency);
    const problem = claimProblem(body.title, body.description, body.urgentAvailable, body.guaranteeNote);
    if (problem) throw validationError(problem.path, problem.message);
    await this.checkCategory(body.categoryId);
    await this.checkMedia(scope, actorId, body.mediaIds);

    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO service_offers (org_id, provider_id, created_by, category_id, title, description, status, price_kind, price_minor, currency,
          duration_min, cancel_notice_hours, city, lat, lng, radius_km, utc_offset_minutes, urgent_available, guarantee_note)
        VALUES (${scope.orgId ?? null}::uuid, ${scope.providerId ?? null}::uuid, ${actorId}::uuid, ${body.categoryId}::uuid, ${body.title},
          ${body.description ?? null}, ${body.status}, ${body.priceKind}, ${body.priceMinor ?? null}, ${body.currency ?? null},
          ${body.durationMin}, ${body.cancelNoticeHours}, ${body.city}, ${lat}, ${lng}, ${body.radiusKm}, ${body.utcOffsetMinutes},
          ${body.urgentAvailable}, ${body.guaranteeNote ?? null})
        RETURNING id`);
      const offerId = (res.rows[0] as { id: string }).id;
      await this.writeMedia(tx, offerId, body.mediaIds);
      return offerId;
    });
    await this.audit.record({ action: 'service.created', actorUserId: actorId, meta, metadata: { offerId: id, ...(scope.orgId ? { orgId: scope.orgId } : {}) } });
    return this.getOwned(scope, id);
  }

  async update(scope: OfferScope, actorId: string, id: string, patch: UpdateServiceOfferRequest, meta: RequestMeta): Promise<ServiceOfferDetail> {
    const cur = await this.findOwnedRow(scope, id);
    const title = patch.title ?? cur.title;
    const description = patch.description === undefined ? cur.description : patch.description;
    const urgent = patch.urgentAvailable ?? cur.urgent_available;
    const guarantee = patch.guaranteeNote === undefined ? cur.guarantee_note : patch.guaranteeNote;
    const problem = claimProblem(title, description, urgent, guarantee);
    if (problem) throw validationError(problem.path, problem.message);

    const priceKind = patch.priceKind ?? cur.price_kind;
    let priceMinor: number | null = patch.priceMinor === undefined ? (cur.price_minor === null ? null : Number(cur.price_minor)) : patch.priceMinor;
    let currency = patch.currency === undefined ? cur.currency?.trim() ?? null : patch.currency;
    if (priceKind === 'quote') {
      if (patch.priceMinor !== undefined && patch.priceMinor !== null) throw validationError('priceMinor', 'a quote offer has no price');
      priceMinor = null;
      currency = null;
    } else if (priceMinor === null || currency === null) {
      throw validationError('priceMinor', 'a fixed price needs priceMinor and currency');
    }
    this.checkCurrency(currency ?? undefined);
    if (patch.categoryId) await this.checkCategory(patch.categoryId);
    if (patch.mediaIds) await this.checkMedia(scope, actorId, patch.mediaIds);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE service_offers SET title = ${title}, description = ${description}, category_id = ${patch.categoryId ?? cur.category_id}::uuid,
          status = ${patch.status ?? cur.status}, price_kind = ${priceKind}, price_minor = ${priceMinor}, currency = ${currency},
          duration_min = ${patch.durationMin ?? cur.duration_min}, cancel_notice_hours = ${patch.cancelNoticeHours ?? cur.cancel_notice_hours},
          city = ${patch.city ?? cur.city}, lat = ${patch.lat ?? cur.lat}, lng = ${patch.lng ?? cur.lng}, radius_km = ${patch.radiusKm ?? cur.radius_km},
          utc_offset_minutes = ${patch.utcOffsetMinutes ?? cur.utc_offset_minutes}, urgent_available = ${urgent}, guarantee_note = ${guarantee},
          updated_at = now()
        WHERE id = ${id}::uuid`);
      if (patch.mediaIds) {
        await tx.execute(sql`DELETE FROM service_offer_media WHERE offer_id = ${id}::uuid`);
        await this.writeMedia(tx, id, patch.mediaIds);
      }
    });
    await this.audit.record({ action: 'service.updated', actorUserId: actorId, meta, metadata: { offerId: id, fields: Object.keys(patch) } });
    return this.getOwned(scope, id);
  }

  /** Archives (never deletes: bookings and reviews keep referring to it). Idempotent. */
  async archive(scope: OfferScope, actorId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.findOwnedRow(scope, id);
    await this.db.execute(sql`UPDATE service_offers SET status = 'archived', updated_at = now() WHERE id = ${id}::uuid AND status <> 'archived'`);
    await this.audit.record({ action: 'service.archived', actorUserId: actorId, meta, metadata: { offerId: id } });
  }

  async listOwned(scope: OfferScope, q: OwnServiceListQuery): Promise<ServiceOfferList> {
    const cursor = q.cursor ? decodeCursor(q.cursor, 'time') : null;
    const res = await this.db.execute(sql`
      SELECT ${OFFER_COLUMNS} ${OFFER_FROM}
      WHERE ${scopeSql(scope)} ${q.status ? sql`AND s.status = ${q.status}` : sql``}
        ${cursor ? sql`AND (s.created_at, s.id) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY s.created_at DESC, s.id DESC LIMIT ${q.limit + 1}`);
    return this.pageOf(res.rows as unknown as OfferRow[], q.limit, (r) => encodeCursor(r.ts, r.id));
  }

  async getOwned(scope: OfferScope, id: string): Promise<ServiceOfferDetail> {
    const row = await this.findOwnedRow(scope, id);
    return this.detail(row);
  }

  /** Replaces the whole schedule (weekly windows and date exceptions). */
  async setAvailability(scope: OfferScope, actorId: string, id: string, body: SetAvailabilityRequest, meta: RequestMeta): Promise<Availability> {
    await this.findOwnedRow(scope, id);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM service_offers WHERE id = ${id}::uuid FOR UPDATE`);
      await tx.execute(sql`DELETE FROM service_availability_rules WHERE offer_id = ${id}::uuid`);
      await tx.execute(sql`DELETE FROM service_availability_exceptions WHERE offer_id = ${id}::uuid`);
      for (const r of body.rules) {
        await tx.execute(sql`
          INSERT INTO service_availability_rules (offer_id, weekday, start_min, end_min)
          VALUES (${id}::uuid, ${r.weekday}, ${minutesOf(r.start)}, ${r.end === '24:00' ? 1440 : minutesOf(r.end)})`);
      }
      for (const e of body.exceptions) {
        await tx.execute(sql`
          INSERT INTO service_availability_exceptions (offer_id, day, closed, start_min, end_min)
          VALUES (${id}::uuid, ${e.date}::date, ${e.closed}, ${e.start ? minutesOf(e.start) : null}, ${e.end ? minutesOf(e.end) : null})`);
      }
    });
    await this.audit.record({ action: 'service.updated', actorUserId: actorId, meta, metadata: { offerId: id, fields: ['availability'] } });
    return this.readAvailability(id);
  }

  // ---- buyer side -------------------------------------------------------------------------------

  async detailFor(viewerId: string, id: string): Promise<ServiceOfferDetail> {
    if (!UUID_RE.test(id)) throw serviceNotFound();
    const row = await this.loadVisible(viewerId, id);
    if (!row) throw serviceNotFound();
    return this.detail(row);
  }

  /** Published offers visible to the viewer. With lat/lng: within radiusKm of the point, nearest first. The point is never stored. */
  async discover(viewerId: string, q: ServiceDiscoveryQuery): Promise<ServiceOfferList> {
    const geo = q.lat !== undefined && q.lng !== undefined;
    const filters: SQL[] = [serviceVisibleSql(viewerId)];
    if (q.categoryId) filters.push(sql`s.category_id = ${q.categoryId}::uuid`);
    if (q.q) {
      const pattern = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filters.push(sql`(s.title ILIKE ${pattern} OR s.description ILIKE ${pattern})`);
    }
    let dist: SQL = sql`NULL::float8`;
    let outer: SQL = sql``;
    let order: SQL = sql`ORDER BY t.created_at DESC, t.id DESC`;
    if (geo) {
      const box = boundingBox(q.lat!, q.lng!, q.radiusKm);
      dist = sql`(2 * ${EARTH_RADIUS_KM}::float8 * asin(sqrt(least(1.0::float8,
        power(sin(radians(s.lat - ${q.lat!}::float8) / 2), 2)
        + cos(radians(${q.lat!}::float8)) * cos(radians(s.lat)) * power(sin(radians(s.lng - ${q.lng!}::float8) / 2), 2)))))`;
      filters.push(sql`s.lat BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8`);
      if (box.lng) filters.push(sql`s.lng BETWEEN ${box.lng[0]}::float8 AND ${box.lng[1]}::float8`);
      outer = sql`AND t.d <= ${q.radiusKm}::float8`;
      order = sql`ORDER BY t.d, t.id`;
      if (q.cursor) {
        const c = decodeDistanceCursor(q.cursor);
        outer = sql`${outer} AND (t.d, t.id) > (${c.d}::float8, ${c.id}::uuid)`;
      }
    } else if (q.cursor) {
      const c = decodeCursor(q.cursor, 'time');
      outer = sql`AND (t.created_at, t.id) < (${c.key}::timestamptz, ${c.id}::uuid)`;
    }
    const res = await this.db.execute(sql`
      SELECT * FROM (
        SELECT ${OFFER_COLUMNS}, ${dist} AS d, (${dist})::text AS d_text ${OFFER_FROM}
        WHERE ${sql.join(filters, sql` AND `)}
      ) t
      WHERE true ${outer}
      ${order} LIMIT ${q.limit + 1}`);
    return this.pageOf(res.rows as unknown as OfferRow[], q.limit, (r) => (geo ? encodeCursor(r.d_text!, r.id) : encodeCursor(r.ts, r.id)), q);
  }

  /** Free slots in [from, to] (default: the next 7 days, at most 14 days), bookings excluded. */
  async slots(viewerId: string, id: string, q: SlotsQuery): Promise<SlotList> {
    if (!UUID_RE.test(id)) throw serviceNotFound();
    const row = await this.loadVisible(viewerId, id);
    if (!row) throw serviceNotFound();
    const now = new Date();
    const from = q.from ? new Date(q.from) : now;
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 7 * 86_400_000);
    if (to <= from) throw validationError('to', 'to must be after from');
    if (to.getTime() - from.getTime() > MAX_SLOT_RANGE_DAYS * 86_400_000) throw validationError('to', `the range is at most ${MAX_SLOT_RANGE_DAYS} days`);
    return { items: (await this.freeSlots(this.db, row, from, to, now)).map((s) => ({ startsAt: s.start.toISOString(), endsAt: s.end.toISOString() })) };
  }

  // ---- shared with bookings ---------------------------------------------------------------------

  async loadVisible(viewerId: string, id: string): Promise<OfferRow | null> {
    const res = await this.db.execute(sql`SELECT ${OFFER_COLUMNS} ${OFFER_FROM} WHERE s.id = ${id}::uuid AND ${serviceVisibleSql(viewerId)}`);
    return (res.rows[0] as unknown as OfferRow | undefined) ?? null;
  }

  async freeSlots(db: Pick<Db, 'execute'>, row: Pick<OfferRow, 'id' | 'duration_min' | 'utc_offset_minutes'>, from: Date, to: Date, now: Date) {
    const [rules, exceptions, taken] = await Promise.all([
      db.execute(sql`SELECT weekday, start_min, end_min FROM service_availability_rules WHERE offer_id = ${row.id}::uuid`),
      db.execute(sql`SELECT day::text AS day, closed, start_min, end_min FROM service_availability_exceptions WHERE offer_id = ${row.id}::uuid`),
      db.execute(sql`
        SELECT starts_at, ends_at FROM service_bookings
        WHERE offer_id = ${row.id}::uuid AND status IN ('requested', 'confirmed') AND starts_at < ${to.toISOString()}::timestamptz AND ends_at > ${from.toISOString()}::timestamptz`),
    ]);
    const busy = (taken.rows as { starts_at: string | Date; ends_at: string | Date }[]).map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const);
    return computeSlots({
      from,
      to,
      now,
      durationMin: row.duration_min,
      utcOffsetMinutes: row.utc_offset_minutes,
      rules: (rules.rows as { weekday: number; start_min: number; end_min: number }[]).map((r): RuleRow => ({ weekday: r.weekday, startMin: r.start_min, endMin: r.end_min })),
      exceptions: (exceptions.rows as { day: string; closed: boolean; start_min: number | null; end_min: number | null }[]).map(
        (e): ExceptionRow => ({ day: e.day, closed: e.closed, startMin: e.start_min, endMin: e.end_min }),
      ),
    }).filter((s) => !busy.some(([a, b]) => s.start.getTime() < b && s.end.getTime() > a));
  }

  // ---- internals --------------------------------------------------------------------------------

  private async findOwnedRow(scope: OfferScope, id: string): Promise<OfferRow> {
    if (!UUID_RE.test(id)) throw serviceNotFound();
    const res = await this.db.execute(sql`SELECT ${OFFER_COLUMNS} ${OFFER_FROM} WHERE s.id = ${id}::uuid AND ${scopeSql(scope)}`);
    const row = res.rows[0] as unknown as OfferRow | undefined;
    if (!row) throw serviceNotFound();
    return row;
  }

  private checkCurrency(currency: string | undefined): void {
    if (currency !== undefined && !this.env.COMMERCE_CURRENCIES.includes(currency)) {
      throw validationError('currency', `currency must be one of ${this.env.COMMERCE_CURRENCIES.join(', ')}`);
    }
  }

  private async checkCategory(categoryId: string): Promise<void> {
    const res = await this.db.execute(sql`SELECT 1 FROM service_categories WHERE id = ${categoryId}::uuid`);
    if (res.rows.length === 0) throw validationError('categoryId', 'unknown category');
  }

  /** Photos: ready "product" uploads of the provider, or of an active member of the organisation. */
  private async checkMedia(scope: OfferScope, actorId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    if (new Set(ids).size !== ids.length) throw validationError('mediaIds', 'duplicate media');
    const res = await this.db.execute(sql`
      SELECT m.id FROM media_assets m
      WHERE m.id = ANY(${uuidArray(ids)}) AND m.purpose = 'product' AND m.status = 'ready'
        AND (${scope.orgId
          ? sql`EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = ${scope.orgId}::uuid AND om.user_id = m.owner_user_id AND om.status = 'active')`
          : sql`m.owner_user_id = ${scope.providerId}::uuid`})`);
    if (res.rows.length !== ids.length) throw validationError('mediaIds', 'must be ready "product" uploads of the provider or of members of the organization');
    void actorId;
  }

  private async writeMedia(tx: Pick<Db, 'execute'>, offerId: string, ids: string[]): Promise<void> {
    for (const [i, mediaId] of ids.entries()) {
      await tx.execute(sql`INSERT INTO service_offer_media (offer_id, media_id, position) VALUES (${offerId}::uuid, ${mediaId}::uuid, ${i})`);
    }
  }

  private async readAvailability(offerId: string): Promise<Availability> {
    const [rules, exceptions] = await Promise.all([
      this.db.execute(sql`SELECT weekday, start_min, end_min FROM service_availability_rules WHERE offer_id = ${offerId}::uuid ORDER BY weekday, start_min`),
      this.db.execute(sql`SELECT day::text AS day, closed, start_min, end_min FROM service_availability_exceptions WHERE offer_id = ${offerId}::uuid ORDER BY day, start_min NULLS FIRST`),
    ]);
    return {
      rules: (rules.rows as { weekday: number; start_min: number; end_min: number }[]).map((r) => ({
        weekday: r.weekday,
        start: hhmmOf(r.start_min),
        end: r.end_min === 1440 ? '24:00' : hhmmOf(r.end_min),
      })),
      exceptions: (exceptions.rows as { day: string; closed: boolean; start_min: number | null; end_min: number | null }[]).map((e) => ({
        date: e.day,
        closed: e.closed,
        ...(e.start_min !== null ? { start: hhmmOf(e.start_min) } : {}),
        ...(e.end_min !== null ? { end: e.end_min === 1440 ? '24:00' : hhmmOf(e.end_min) } : {}),
      })),
    };
  }

  private async detail(row: OfferRow): Promise<ServiceOfferDetail> {
    const [media, availability] = await Promise.all([this.mediaOf([row.id]), this.readAvailability(row.id)]);
    return { ...toOffer(row, media.get(row.id) ?? [], null), availability };
  }

  private async pageOf(rows: OfferRow[], limit: number, cursorOf: (r: OfferRow) => string, q?: ServiceDiscoveryQuery): Promise<ServiceOfferList> {
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const media = await this.mediaOf(page.map((r) => r.id));
    return {
      items: page.map((r) => toOffer(r, media.get(r.id) ?? [], q?.lat !== undefined ? r.d ?? null : null)),
      nextCursor: rows.length > limit && last ? cursorOf(last) : null,
    };
  }

  private async mediaOf(ids: string[]): Promise<Map<string, { id: string; mime: string | null; contentUrl: string }[]>> {
    const out = new Map<string, { id: string; mime: string | null; contentUrl: string }[]>();
    if (ids.length === 0) return out;
    const res = await this.db.execute(sql`
      SELECT om.offer_id, m.id, m.mime FROM service_offer_media om JOIN media_assets m ON m.id = om.media_id
      WHERE om.offer_id = ANY(${uuidArray(ids)}) ORDER BY om.position`);
    for (const r of res.rows as { offer_id: string; id: string; mime: string | null }[]) {
      const list = out.get(r.offer_id) ?? [];
      list.push({ id: r.id, mime: r.mime, contentUrl: contentUrlOf(r.id) });
      out.set(r.offer_id, list);
    }
    return out;
  }
}

function toOffer(r: OfferRow, media: ServiceOffer['media'], distance: number | null): ServiceOffer {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryId: r.category_id,
    status: r.status,
    hidden: r.hidden,
    priceKind: r.price_kind,
    priceMinor: r.price_minor === null ? null : Number(r.price_minor),
    currency: r.currency?.trim() ?? null,
    paymentMode: 'on_site',
    durationMin: r.duration_min,
    cancelNoticeHours: r.cancel_notice_hours,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    radiusKm: r.radius_km,
    utcOffsetMinutes: r.utc_offset_minutes,
    urgentAvailable: r.urgent_available,
    guaranteeNote: r.guarantee_note,
    media,
    provider: providerRefOf(r),
    distanceKm: distance === null ? null : Math.round(Number(distance) * 1000) / 1000,
    inServiceZone: distance === null ? null : Number(distance) <= r.radius_km,
    ratingCount: r.rating_count,
    averageRating: r.rating_avg === null ? null : Math.round(r.rating_avg * 100) / 100,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function decodeDistanceCursor(cursor: string): { d: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && UUID_RE.test(v[1]) && Number.isFinite(Number(v[0]))) {
      return { d: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}
