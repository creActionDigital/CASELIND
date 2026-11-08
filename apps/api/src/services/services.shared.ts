import { type SQL, sql } from 'drizzle-orm';

export { decodeCursor, encodeCursor, UUID_RE, validationError } from '../catalog/catalog.shared.js';

export const DAY_MS = 86_400_000;
export const MAX_SLOT_RANGE_DAYS = 14;

/** `ARRAY[...]::uuid[]` from a list of uuids (never empty at call sites). */
export const uuidArray = (ids: string[]): SQL => sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]::uuid[]`;

export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmmOf = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface RuleRow {
  weekday: number;
  startMin: number;
  endMin: number;
}
export interface ExceptionRow {
  day: string;
  closed: boolean;
  startMin: number | null;
  endMin: number | null;
}

/**
 * Free-of-bookings slots of an offer inside [from, to]: weekly windows in the provider's fixed local time
 * (utc offset, no DST), replaced on a date by its exception rows (closed, or only the listed windows).
 * Slots are `durationMin` long, back to back inside each window, entirely inside the range and in the future.
 */
export function computeSlots(p: {
  from: Date;
  to: Date;
  now: Date;
  durationMin: number;
  utcOffsetMinutes: number;
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}): { start: Date; end: Date }[] {
  const offMs = p.utcOffsetMinutes * 60_000;
  const durMs = p.durationMin * 60_000;
  const out = new Map<number, { start: Date; end: Date }>();
  for (let day = Math.floor((p.from.getTime() + offMs) / DAY_MS) * DAY_MS; day <= p.to.getTime() + offMs; day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    const iso = new Date(day).getUTCDay() === 0 ? 7 : new Date(day).getUTCDay();
    const ex = p.exceptions.filter((e) => e.day === date);
    const windows =
      ex.length > 0
        ? ex.filter((e) => !e.closed).map((e) => ({ s: e.startMin!, e: e.endMin! }))
        : p.rules.filter((r) => r.weekday === iso).map((r) => ({ s: r.startMin, e: r.endMin }));
    for (const w of windows) {
      for (let t = w.s; t + p.durationMin <= w.e; t += p.durationMin) {
        const startMs = day + t * 60_000 - offMs;
        if (startMs < p.from.getTime() || startMs + durMs > p.to.getTime() || startMs <= p.now.getTime()) continue;
        out.set(startMs, { start: new Date(startMs), end: new Date(startMs + durMs) });
      }
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** "urgent" / "garanti" may only appear when the provider filled the matching explicit field (CDC §11). */
export function claimProblem(
  title: string,
  description: string | null | undefined,
  urgentAvailable: boolean,
  guaranteeNote: string | null | undefined,
): { path: string; message: string } | null {
  const text = `${title} ${description ?? ''}`;
  if (!urgentAvailable && /urgen/i.test(text)) return { path: 'urgentAvailable', message: 'mentions urgency: set urgentAvailable to true first' };
  if (!guaranteeNote && /garanti/i.test(text)) return { path: 'guaranteeNote', message: 'mentions a guarantee: fill guaranteeNote first' };
  return null;
}

/**
 * Whether the offer (alias `s`, joined with org `o` and provider user `pu`) is shown to the viewer: published, not hidden,
 * organisation active and public with no blocked owner / active provider not blocked with the viewer (either way).
 */
export function serviceVisibleSql(viewerId: string): SQL {
  return sql`(s.status = 'published' AND NOT s.hidden AND (
    (s.org_id IS NOT NULL AND o.status = 'active' AND o.visibility = 'public' AND NOT EXISTS (
       SELECT 1 FROM org_members om
       JOIN user_blocks b ON (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = om.user_id)
                          OR (b.blocker_id = om.user_id AND b.blocked_id = ${viewerId}::uuid)
       WHERE om.org_id = s.org_id AND om.role = 'owner' AND om.status = 'active'))
    OR (s.provider_id IS NOT NULL AND pu.status = 'active' AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
       WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = s.provider_id)
          OR (b.blocker_id = s.provider_id AND b.blocked_id = ${viewerId}::uuid)))))`;
}

export const OFFER_FROM = sql`FROM service_offers s
  LEFT JOIN organizations o ON o.id = s.org_id
  LEFT JOIN users pu ON pu.id = s.provider_id
  LEFT JOIN service_providers sp ON sp.user_id = s.provider_id`;

export const OFFER_COLUMNS = sql`s.*, s.created_at::text AS ts,
  o.slug::text AS org_slug, o.name AS org_name, (o.verification_status = 'verified') AS org_verified,
  sp.display_name AS prov_name, (sp.verification_status = 'verified') AS prov_verified, pu.handle::text AS prov_handle,
  (SELECT count(*)::int FROM service_reviews r WHERE r.offer_id = s.id AND NOT r.hidden) AS rating_count,
  (SELECT avg(r.rating)::float8 FROM service_reviews r WHERE r.offer_id = s.id AND NOT r.hidden) AS rating_avg`;
