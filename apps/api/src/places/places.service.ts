import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type OpeningHours,
  type OrgLocation,
  type Place,
  type PlaceList,
  type PlacesQuery,
  type SetOrgLocationRequest,
  type UpdateOrgLocationRequest,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { readOrgLocation } from '../orgs/orgs.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { orgNotFound } from '../orgs/org.guard.js';

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE = 111.32;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Goma is on Central Africa Time (UTC+2, no DST). shortcut: fixed offset, make it per-country when other cities launch. */
const LOCAL_OFFSET_MIN = 120;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Open right now according to the weekly hours; null when the hours are unknown. */
export function isOpenNow(hours: OpeningHours | null, now = new Date()): boolean | null {
  if (!hours) return null;
  const t = new Date(now.getTime() + LOCAL_OFFSET_MIN * 60_000);
  const hm = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  return (hours[DAYS[t.getUTCDay()]!] ?? []).some((iv) => iv.open <= hm && hm < iv.close);
}

const badCursor = () =>
  new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'cursor', message: 'invalid cursor' }]);

/** Opaque keyset cursor: (distance as shortest round-trip text, org id). */
const encodeCursor = (d: string, id: string): string => Buffer.from(JSON.stringify([d, id])).toString('base64url');
function decodeCursor(cursor: string): { d: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && UUID_RE.test(v[1]) && Number.isFinite(Number(v[0]))) {
      return { d: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw badCursor();
}

/**
 * Bounding box (degrees) around a point, used to prefilter before the exact distance.
 * Longitude is left unbounded near the poles and across the antimeridian (conservative).
 */
export function boundingBox(lat: number, lng: number, radiusKm: number): { minLat: number; maxLat: number; lng: [number, number] | null } {
  const dLat = radiusKm / KM_PER_DEGREE;
  const minLat = Math.max(-90, lat - dLat);
  const maxLat = Math.min(90, lat + dLat);
  const cos = Math.cos((lat * Math.PI) / 180);
  let lngRange: [number, number] | null = null;
  if (Math.abs(lat) + dLat < 89 && cos > 0.01) {
    const dLng = radiusKm / (KM_PER_DEGREE * cos);
    if (lng - dLng >= -180 && lng + dLng <= 180) lngRange = [lng - dLng, lng + dLng];
  }
  return { minLat, maxLat, lng: lngRange };
}

/** The org (alias `o`) has no active owner blocked with the viewer (either way): same rule as the storefront. */
export const orgOwnerNotBlockedSql = (viewerId: string): SQL => sql`NOT EXISTS (
  SELECT 1 FROM org_members om
  JOIN user_blocks b ON (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = om.user_id)
                     OR (b.blocker_id = om.user_id AND b.blocked_id = ${viewerId}::uuid)
  WHERE om.org_id = o.id AND om.role = 'owner' AND om.status = 'active')`;

interface PlaceRow {
  id: string;
  slug: string;
  name: string;
  kind: Place['kind'];
  logo_url: string | null;
  city: string | null;
  address: string | null;
  verified: boolean;
  phone: string | null;
  source: 'osm' | null;
  opening_hours: OpeningHours | null;
  lat: number;
  lng: number;
  location_label: string | null;
  d: number;
  d_text: string;
}

@Injectable()
export class PlacesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---- organisation side -----------------------------------------------------------------------

  /** Null when the organisation has no location yet. */
  async getLocation(orgId: string): Promise<OrgLocation | null> {
    return readOrgLocation(this.db, orgId);
  }

  async setLocation(orgId: string, actorId: string, body: SetOrgLocationRequest, meta: RequestMeta): Promise<OrgLocation> {
    const res = await this.db.execute(sql`
      UPDATE organizations SET lat = ${body.lat}, lng = ${body.lng}, location_label = ${body.label ?? null}, updated_at = now()
      WHERE id = ${orgId}::uuid AND lat IS NULL
      RETURNING lat, lng, location_label`);
    const row = res.rows[0] as { lat: number; lng: number; location_label: string | null } | undefined;
    if (!row) {
      const exists = await this.db.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}::uuid`);
      if (exists.rows.length === 0) throw orgNotFound();
      throw AppError.conflict('This organization already has a location: use PATCH', { reason: 'location_exists' });
    }
    await this.audit.record({ action: 'org.updated', actorUserId: actorId, meta, metadata: { orgId, fields: ['location'] } });
    return { lat: row.lat, lng: row.lng, label: row.location_label };
  }

  async updateLocation(orgId: string, actorId: string, patch: UpdateOrgLocationRequest, meta: RequestMeta): Promise<OrgLocation> {
    return this.db.transaction(async (tx) => {
      const cur = await tx.execute(sql`SELECT lat, lng, location_label FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      const c = cur.rows[0] as { lat: number | null; lng: number | null; location_label: string | null } | undefined;
      if (!c) throw orgNotFound();
      if (c.lat === null || c.lng === null) throw AppError.notFound('This organization has no location');
      const next = {
        lat: patch.lat ?? c.lat,
        lng: patch.lng ?? c.lng,
        label: patch.label === undefined ? c.location_label : patch.label,
      };
      await tx.execute(sql`
        UPDATE organizations SET lat = ${next.lat}, lng = ${next.lng}, location_label = ${next.label}, updated_at = now()
        WHERE id = ${orgId}::uuid`);
      await this.audit.record({ action: 'org.updated', actorUserId: actorId, meta, metadata: { orgId, fields: ['location'] } }, tx);
      return next;
    });
  }

  /** Idempotent. */
  async removeLocation(orgId: string, actorId: string, meta: RequestMeta): Promise<void> {
    const res = await this.db.execute(sql`
      UPDATE organizations SET lat = NULL, lng = NULL, location_label = NULL, updated_at = now()
      WHERE id = ${orgId}::uuid AND lat IS NOT NULL`);
    if ((res.rowCount ?? 0) > 0) {
      await this.audit.record({ action: 'org.updated', actorUserId: actorId, meta, metadata: { orgId, fields: ['location'] } });
    }
  }

  // ---- discovery -------------------------------------------------------------------------------

  /**
   * Public, active organisations with a location within `radiusKm`, nearest first (keyset on
   * (distance, id)). Haversine in plain SQL, prefiltered by a bounding box that the
   * `organizations_geo_idx` index can serve (ADR-019). The caller's position only exists in this
   * request: it is never stored or logged.
   */
  async nearby(viewerId: string, q: PlacesQuery): Promise<PlaceList> {
    const box = boundingBox(q.lat, q.lng, q.radiusKm);
    const dist = sql`(2 * ${EARTH_RADIUS_KM}::float8 * asin(sqrt(least(1.0::float8,
      power(sin(radians(o.lat - ${q.lat}::float8) / 2), 2)
      + cos(radians(${q.lat}::float8)) * cos(radians(o.lat)) * power(sin(radians(o.lng - ${q.lng}::float8) / 2), 2)))))`;
    const filters: SQL[] = [
      sql`o.status = 'active' AND o.visibility = 'public' AND o.lat IS NOT NULL`,
      sql`o.lat BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8`,
      orgOwnerNotBlockedSql(viewerId),
    ];
    if (box.lng) filters.push(sql`o.lng BETWEEN ${box.lng[0]}::float8 AND ${box.lng[1]}::float8`);
    if (q.kind) filters.push(sql`o.kind = ${q.kind}`);
    if (q.q) filters.push(sql`o.name ILIKE ${`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    let cursorSql = sql``;
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      cursorSql = sql`AND (t.d, t.id) > (${c.d}::float8, ${c.id}::uuid)`;
    }
    const res = await this.db.execute(sql`
      SELECT * FROM (
        SELECT o.id, o.slug::text AS slug, o.name, o.kind, o.logo_url, o.city, o.address,
               (o.verification_status = 'verified') AS verified, o.phone, o.source, o.opening_hours, o.lat, o.lng, o.location_label,
               ${dist} AS d, (${dist})::text AS d_text
        FROM organizations o
        WHERE ${sql.join(filters, sql` AND `)}
      ) t
      WHERE t.d <= ${q.radiusKm}::float8 ${cursorSql}
      ORDER BY t.d, t.id
      LIMIT ${q.limit + 1}`);
    const rows = res.rows as unknown as PlaceRow[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        kind: r.kind,
        logoUrl: r.logo_url,
        city: r.city,
        address: r.address,
        verified: r.verified,
        phone: r.phone,
        source: r.source,
        openNow: isOpenNow(r.opening_hours),
        lat: r.lat,
        lng: r.lng,
        label: r.location_label,
        distanceKm: Math.round(Number(r.d) * 1000) / 1000,
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.d_text, last.id) : null,
    };
  }
}
