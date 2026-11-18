import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CreateOrgUpdateRequest,
  ErrorCodes,
  ORG_UPDATES_MAX,
  type OrgUpdate,
  type OrgUpdateList,
  type OrgUpdateListQuery,
  type UpdateOrgUpdateRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { orgNotFound } from './org.guard.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK_RE = /^-?\d+(\.\d+)?$/;

type Row = {
  id: string;
  kind: 'post' | 'promo' | 'event';
  title: string;
  body: string;
  starts_at: Date | null;
  ends_at: Date | null;
  place: string | null;
  hidden: boolean;
  created_at: Date;
  rank: string;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toUpdate = (r: Row): OrgUpdate => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  place: r.place,
  hidden: r.hidden,
  createdAt: iso(r.created_at)!,
});

const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);

function decodeCursor(cursor: string): { rank: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && RANK_RE.test(v[0]) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { rank: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}

/**
 * Sort key, ascending: events first by start date, then everything else newest first. The 1e12 offset
 * puts every event (epoch ~1.7e9 - 1e12) before every other item (-epoch ~ -1.7e9).
 */
const PUBLIC_RANK: SQL = sql`CASE WHEN u.kind = 'event' THEN extract(epoch FROM u.starts_at) - 1000000000000 ELSE -extract(epoch FROM u.created_at) END`;
const STAFF_RANK: SQL = sql`-extract(epoch FROM u.created_at)`;

/** Still worth showing: posts always, promotions until they end, events until they end (one day after the start when open-ended). */
const LIVE: SQL = sql`(u.kind = 'post'
  OR (u.kind = 'promo' AND (u.ends_at IS NULL OR u.ends_at > now()))
  OR (u.kind = 'event' AND COALESCE(u.ends_at, u.starts_at + interval '1 day') > now()))`;

const PUBLIC_ORG: SQL = sql`o.visibility = 'public' AND o.status = 'active'`;

/** Publications, promotions and events of an organisation. Audit holds ids and kind only, never the text. */
@Injectable()
export class OrgUpdatesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly moderation: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.moderation.register('org_update', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM org_updates u JOIN organizations o ON o.id = u.org_id WHERE u.id = ${id}::uuid
          AND ((${PUBLIC_ORG} AND NOT u.hidden AND ${LIVE})
            OR EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = u.org_id AND m.user_id = ${viewerId}::uuid AND m.status = 'active'))`);
        return res.rows.length > 0;
      },
      // The author, or the oldest active owner when the author account is gone.
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ a: string | null }>(sql`SELECT COALESCE(u.created_by,
            (SELECT m.user_id FROM org_members m WHERE m.org_id = u.org_id AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at, m.user_id LIMIT 1)) AS a
          FROM org_updates u WHERE u.id = ${id}::uuid`);
        return res.rows[0]?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE org_updates SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  private async page(filters: SQL[], rank: SQL, q: OrgUpdateListQuery): Promise<OrgUpdateList> {
    const outer: SQL[] = [sql`true`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      outer.push(sql`(x.rank, x.id) > (${c.rank}::numeric, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row>(sql`
      SELECT x.* FROM (
        SELECT u.id, u.kind, u.title, u.body, u.starts_at, u.ends_at, u.place, u.hidden, u.created_at, ${rank} AS rank
        FROM org_updates u JOIN organizations o ON o.id = u.org_id WHERE ${sql.join(filters, sql` AND `)}
      ) x WHERE ${sql.join(outer, sql` AND `)} ORDER BY x.rank, x.id LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toUpdate),
      nextCursor: res.rows.length > q.limit && last ? Buffer.from(JSON.stringify([String(last.rank), last.id])).toString('base64url') : null,
    };
  }

  /** Staff view: everything, hidden included, newest first. */
  orgList(orgId: string, q: OrgUpdateListQuery): Promise<OrgUpdateList> {
    return this.page([sql`u.org_id = ${orgId}::uuid`], STAFF_RANK, q);
  }

  /** No token: only public active organisations (anything else is a plain 404), live and not hidden items. */
  async publicList(slug: string, q: OrgUpdateListQuery): Promise<OrgUpdateList> {
    const res = await this.db.execute<{ id: string }>(sql`SELECT o.id FROM organizations o WHERE o.slug = ${slug} AND ${PUBLIC_ORG}`);
    if (!res.rows[0]) throw orgNotFound();
    return this.page([sql`u.org_id = ${res.rows[0].id}::uuid`, sql`NOT u.hidden`, LIVE], PUBLIC_RANK, q);
  }

  private async one(id: string): Promise<OrgUpdate> {
    const res = await this.db.execute<Row>(sql`SELECT u.id, u.kind, u.title, u.body, u.starts_at, u.ends_at, u.place, u.hidden, u.created_at, '0' AS rank FROM org_updates u WHERE u.id = ${id}::uuid`);
    return toUpdate(res.rows[0]!);
  }

  async create(orgId: string, userId: string, b: CreateOrgUpdateRequest, meta: RequestMeta): Promise<OrgUpdate> {
    this.check(b.kind, b.startsAt ?? null, b.endsAt ?? null);
    const id = await this.db.transaction(async (tx) => {
      // Locking the org serialises concurrent creations so the cap cannot be overshot.
      const org = await tx.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`);
      if (org.rows.length === 0) throw orgNotFound();
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_updates WHERE org_id = ${orgId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= ORG_UPDATES_MAX) throw AppError.conflict(`An organization can have at most ${ORG_UPDATES_MAX} updates`, { reason: 'limit', limit: ORG_UPDATES_MAX });
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO org_updates (org_id, kind, title, body, starts_at, ends_at, place, created_by)
        VALUES (${orgId}::uuid, ${b.kind}, ${b.title}, ${b.body}, ${b.startsAt ?? null}::timestamptz, ${b.endsAt ?? null}::timestamptz, ${b.place ?? null}, ${userId}::uuid) RETURNING id`);
      const newId = r.rows[0]!.id;
      await this.audit.record({ action: 'org.update_created', actorUserId: userId, meta, metadata: { orgId, updateId: newId, kind: b.kind } }, tx);
      return newId;
    });
    return this.one(id);
  }

  /** Merges the patch with the current row (locked), then validates the result as a whole. */
  async update(orgId: string, userId: string, id: string, b: UpdateOrgUpdateRequest, meta: RequestMeta): Promise<OrgUpdate> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Update not found');
    await this.db.transaction(async (tx) => {
      const cur = (await tx.execute<Row>(sql`SELECT u.id, u.kind, u.title, u.body, u.starts_at, u.ends_at, u.place, u.hidden, u.created_at, '0' AS rank
        FROM org_updates u WHERE u.id = ${id}::uuid AND u.org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw AppError.notFound('Update not found');
      const next = {
        kind: b.kind ?? cur.kind,
        title: b.title ?? cur.title,
        body: b.body ?? cur.body,
        startsAt: b.startsAt !== undefined ? b.startsAt : iso(cur.starts_at),
        endsAt: b.endsAt !== undefined ? b.endsAt : iso(cur.ends_at),
        place: b.place !== undefined ? b.place : cur.place,
      };
      this.check(next.kind, next.startsAt, next.endsAt);
      await tx.execute(sql`UPDATE org_updates SET kind = ${next.kind}, title = ${next.title}, body = ${next.body}, starts_at = ${next.startsAt}::timestamptz,
        ends_at = ${next.endsAt}::timestamptz, place = ${next.place} WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'org.update_changed', actorUserId: userId, meta, metadata: { orgId, updateId: id, kind: next.kind, fields: Object.keys(b) } }, tx);
    });
    return this.one(id);
  }

  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Update not found');
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ kind: string }>(sql`DELETE FROM org_updates WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING kind`);
      if (!r.rows[0]) throw AppError.notFound('Update not found');
      await this.audit.record({ action: 'org.update_deleted', actorUserId: userId, meta, metadata: { orgId, updateId: id, kind: r.rows[0].kind } }, tx);
    });
  }

  private check(kind: string, startsAt: string | null, endsAt: string | null): void {
    if (kind === 'event' && !startsAt) throw invalid('startsAt', 'required for an event');
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw invalid('endsAt', 'must be after startsAt');
  }
}
