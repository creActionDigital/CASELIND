import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminAnnouncement,
  type AdminAnnouncementList,
  type AdminAnnouncementListQuery,
  type CreatePlatformAnnouncementRequest,
  type PageQuery,
  type PlatformAnnouncementList,
  type UpdateAnnouncementRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../stories/cursor.js';

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
const PAGE = 500;

interface Row extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  audience: string;
  starts_at: Date;
  ends_at: Date;
  status: AdminAnnouncement['status'];
  published_at: Date | null;
  created_at: Date;
  ts: string;
}
const COLS = sql`id, title, body, audience, starts_at, ends_at, status, published_at, created_at, created_at::text AS ts`;
const toAdmin = (r: Row): AdminAnnouncement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  audience: r.audience,
  startsAt: iso(r.starts_at)!,
  endsAt: iso(r.ends_at)!,
  status: r.status,
  publishedAt: iso(r.published_at),
  createdAt: iso(r.created_at)!,
});

/** Audience filter against the `users` row `u`: everyone, a platform role, or a country. */
const AUDIENCE_MATCH = sql`(a.audience = 'all' OR (a.audience LIKE 'role:%' AND substr(a.audience, 6) = ANY(u.roles)) OR (a.audience LIKE 'country:%' AND substr(a.audience, 9) = u.country::text))`;

/** Announcements of the platform (CDC §26). Published ones reach the users of their audience during their period; a generic notification goes out once. */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(adminId: string, b: CreatePlatformAnnouncementRequest, meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.db.transaction(async (tx) => {
      const r = await tx.execute<Row>(sql`
        INSERT INTO platform_announcements (title, body, audience, starts_at, ends_at, created_by)
        VALUES (${b.title}, ${b.body}, ${b.audience}, COALESCE(${b.startsAt ?? null}::timestamptz, now()), ${b.endsAt}::timestamptz, ${adminId}::uuid)
        RETURNING ${COLS}`);
      const a = toAdmin(r.rows[0]!);
      await this.audit.record({ action: 'admin.announcement_changed', actorUserId: adminId, meta, metadata: { announcementId: a.id, op: 'created', audience: a.audience } }, tx);
      return a;
    });
  }

  /** Only a draft changes. */
  async update(adminId: string, id: string, b: UpdateAnnouncementRequest, meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status !== 'draft') throw AppError.conflict('Only a draft can be changed', { reason: 'not_draft', status: cur.status });
      const next = { title: b.title ?? cur.title, body: b.body ?? cur.body, audience: b.audience ?? cur.audience, startsAt: b.startsAt ?? iso(cur.starts_at)!, endsAt: b.endsAt ?? iso(cur.ends_at)! };
      if (new Date(next.endsAt) <= new Date(next.startsAt)) throw AppError.conflict('The end must be after the start', { reason: 'bad_period' });
      const r = await tx.execute<Row>(sql`
        UPDATE platform_announcements SET title = ${next.title}, body = ${next.body}, audience = ${next.audience}, starts_at = ${next.startsAt}::timestamptz, ends_at = ${next.endsAt}::timestamptz
        WHERE id = ${id}::uuid RETURNING ${COLS}`);
      await this.audit.record({ action: 'admin.announcement_changed', actorUserId: adminId, meta, metadata: { announcementId: id, op: 'updated' } }, tx);
      return toAdmin(r.rows[0]!);
    });
  }

  /** draft -> published (a period already over cannot be published). The "new announcement" notification follows if the period has begun. */
  async publish(adminId: string, id: string, meta: RequestMeta): Promise<AdminAnnouncement> {
    const out = await this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status !== 'draft') throw AppError.conflict('Only a draft can be published', { reason: 'not_draft', status: cur.status });
      if (new Date(cur.ends_at) <= new Date()) throw AppError.conflict('The period is already over', { reason: 'period_over' });
      const r = await tx.execute<Row>(sql`UPDATE platform_announcements SET status = 'published', published_at = now() WHERE id = ${id}::uuid RETURNING ${COLS}`);
      await this.audit.record({ action: 'admin.announcement_changed', actorUserId: adminId, meta, metadata: { announcementId: id, op: 'published', audience: cur.audience } }, tx);
      return toAdmin(r.rows[0]!);
    });
    // shortcut: notified inline in pages of 500 (a very large audience makes this request long); move to the maintenance queue when audiences grow.
    await this.notifyDue(id).catch((err: unknown) => this.logger.warn(`announcement notification failed: ${(err as Error).name}`));
    return out;
  }

  async end(adminId: string, id: string, meta: RequestMeta): Promise<AdminAnnouncement> {
    return this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status === 'ended') throw AppError.conflict('Already ended', { reason: 'already_ended' });
      const r = await tx.execute<Row>(sql`UPDATE platform_announcements SET status = 'ended' WHERE id = ${id}::uuid RETURNING ${COLS}`);
      await this.audit.record({ action: 'admin.announcement_changed', actorUserId: adminId, meta, metadata: { announcementId: id, op: 'ended' } }, tx);
      return toAdmin(r.rows[0]!);
    });
  }

  async remove(adminId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status !== 'draft') throw AppError.conflict('Only a draft can be deleted', { reason: 'not_draft', status: cur.status });
      await tx.execute(sql`DELETE FROM platform_announcements WHERE id = ${id}::uuid`);
      await this.audit.record({ action: 'admin.announcement_changed', actorUserId: adminId, meta, metadata: { announcementId: id, op: 'deleted' } }, tx);
    });
  }

  private async lock(tx: Pick<Db, 'execute'>, id: string): Promise<Row> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Announcement not found');
    const r = await tx.execute<Row>(sql`SELECT ${COLS} FROM platform_announcements WHERE id = ${id}::uuid FOR UPDATE`);
    if (!r.rows[0]) throw AppError.notFound('Announcement not found');
    return r.rows[0];
  }

  async list(q: AdminAnnouncementListQuery): Promise<AdminAnnouncementList> {
    const where = [sql`true`];
    if (q.status) where.push(sql`status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(sql`(created_at, id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const r = await this.db.execute<Row>(sql`SELECT ${COLS} FROM platform_announcements WHERE ${sql.join(where, sql` AND `)} ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const page = r.rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page.map(toAdmin), nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  /** What the caller may read now: published, inside its period, and addressed to them (filtered server-side). */
  async activeFor(userId: string, q: PageQuery): Promise<PlatformAnnouncementList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const r = await this.db.execute<{ id: string; title: string; body: string; starts_at: Date; ends_at: Date; ts: string }>(sql`
      SELECT a.id, a.title, a.body, a.starts_at, a.ends_at, a.starts_at::text AS ts
      FROM platform_announcements a JOIN users u ON u.id = ${userId}::uuid
      WHERE a.status = 'published' AND a.starts_at <= now() AND a.ends_at > now() AND ${AUDIENCE_MATCH}
        ${cursor ? sql`AND (a.starts_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY a.starts_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const page = r.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((x) => ({ id: x.id, title: x.title, body: x.body, startsAt: iso(x.starts_at)!, endsAt: iso(x.ends_at)! })),
      nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /**
   * Maintenance: published announcements whose period ended become `ended`; published ones that have begun and were not notified yet are
   * (a future start notifies when it begins).
   */
  async runMaintenance(): Promise<void> {
    await this.db.execute(sql`UPDATE platform_announcements SET status = 'ended' WHERE status = 'published' AND ends_at <= now()`);
    const due = await this.db.execute<{ id: string }>(sql`SELECT id FROM platform_announcements WHERE status = 'published' AND notified_at IS NULL AND starts_at <= now() AND ends_at > now()`);
    for (const a of due.rows) await this.notifyDue(a.id).catch((err: unknown) => this.logger.warn(`announcement notification failed: ${(err as Error).name}`));
  }

  /** Claims the announcement (once) then sends one generic notification per recipient, in pages of 500. */
  async notifyDue(id: string): Promise<number> {
    const claim = await this.db.execute<{ audience: string }>(sql`
      UPDATE platform_announcements SET notified_at = now()
      WHERE id = ${id}::uuid AND status = 'published' AND notified_at IS NULL AND starts_at <= now() AND ends_at > now() RETURNING audience`);
    const audience = claim.rows[0]?.audience;
    if (!audience) return 0;
    let after = '00000000-0000-0000-0000-000000000000';
    let sent = 0;
    for (;;) {
      const r = await this.db.execute<{ id: string }>(sql`
        SELECT u.id FROM users u, (SELECT ${audience}::text AS audience) a
        WHERE u.status = 'active' AND u.id > ${after}::uuid AND ${AUDIENCE_MATCH} ORDER BY u.id LIMIT ${PAGE}`);
      if (r.rows.length === 0) break;
      await this.notifications.notifyMany(r.rows.map((u) => ({ userId: u.id, category: 'system' as const, title: 'CASELIND', body: 'Nouvelle annonce', data: { announcementId: id } })));
      sent += r.rows.length;
      after = r.rows[r.rows.length - 1]!.id;
      if (r.rows.length < PAGE) break;
    }
    return sent;
  }
}
