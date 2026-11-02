import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreateReportRequest,
  ModerationActionRequest,
  ModerationActionResult,
  ModerationReportGroupPage,
  ModerationReportsQuery,
  PageQuery,
  Report,
  ReportPage,
  ReportReason,
  ReportTargetType,
} from '@caselind/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { type ReportRow, reports } from '../db/schema.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { decodeCursor, encodeCursor } from '../stories/cursor.js';
import { ModerationRegistry } from './moderation-registry.js';

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  reason: r.reason as ReportReason,
  details: r.details,
  status: r.status,
  resolved: r.status === 'resolved',
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
});

/** Reports filed by users and the moderation queue. No reported content is ever logged or audited. */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ModerationRegistry,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ reports */

  /** 404 when the type is not moderatable or the target is not visible to the reporter; 409 on a duplicate open report. */
  async createReport(reporterId: string, req: CreateReportRequest): Promise<Report> {
    const target = this.registry.get(req.targetType);
    if (!target || !(await target.visibleTo(reporterId, req.targetId))) throw AppError.notFound('Target not found');
    try {
      const [row] = await this.db
        .insert(reports)
        .values({
          reporterId,
          targetType: req.targetType,
          targetId: req.targetId,
          reason: req.reason,
          details: req.details ? req.details : null,
        })
        .returning();
      return toReport(row!);
    } catch (err) {
      const pg = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
      if (pg.code === '23505') throw AppError.conflict('You already have an open report on this item', { reason: 'already_reported' });
      throw err;
    }
  }

  async myReports(userId: string, q: PageQuery): Promise<ReportPage> {
    const filters = [eq(reports.reporterId, userId)];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${reports.createdAt}, ${reports.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ report: reports, exact: sql<string>`${reports.createdAt}::text` })
      .from(reports)
      .where(and(...filters))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toReport(r.report)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.report.id) : null,
    };
  }

  /* ------------------------------------------------------------------ moderation queue */

  /** Reports grouped by target, most recently reported first. */
  async queue(q: ModerationReportsQuery): Promise<ModerationReportGroupPage> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const res = await this.db.execute<{
      target_type: ReportTargetType;
      target_id: string;
      cnt: number;
      first_at: Date;
      last_at: Date;
      last_exact: string;
      reasons: { reason: ReportReason; count: number }[];
    }>(sql`
      WITH per AS (
        SELECT target_type, target_id, reason, count(*)::int AS n, min(created_at) AS f, max(created_at) AS l
        FROM reports
        WHERE status = ${q.status} ${q.targetType ? sql`AND target_type = ${q.targetType}` : sql``}
        GROUP BY target_type, target_id, reason
      )
      SELECT target_type, target_id, sum(n)::int AS cnt, min(f) AS first_at, max(l) AS last_at, max(l)::text AS last_exact,
             jsonb_agg(jsonb_build_object('reason', reason, 'count', n) ORDER BY n DESC, reason) AS reasons
      FROM per
      GROUP BY target_type, target_id
      ${cursor ? sql`HAVING (max(l), target_id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY max(l) DESC, target_id DESC
      LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const items = await Promise.all(
      page.map(async (r) => ({
        targetType: r.target_type,
        targetId: r.target_id,
        status: q.status,
        reportCount: r.cnt,
        reasons: r.reasons,
        authorId: (await this.registry.get(r.target_type)?.authorOf(r.target_id)) ?? null,
        firstReportedAt: new Date(r.first_at).toISOString(),
        lastReportedAt: new Date(r.last_at).toISOString(),
      })),
    );
    const last = page.at(-1);
    return { items, nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.last_exact, last.target_id) : null };
  }

  /**
   * hide / restore change the item's visibility through its module; dismiss only closes the reports.
   * Every action resolves the open reports of the target and is audited (type, id, action: no content).
   */
  async act(moderatorId: string, req: ModerationActionRequest, meta: RequestMeta): Promise<ModerationActionResult> {
    const target = this.registry.get(req.targetType);
    if (!target) throw AppError.notFound('Target not found');
    const author = await target.authorOf(req.targetId);
    if (author === null) {
      const [open] = await this.db
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.targetType, req.targetType), eq(reports.targetId, req.targetId), eq(reports.status, 'open')))
        .limit(1);
      if (!open) throw AppError.notFound('Target not found');
    }
    if (req.action !== 'dismiss') await target.setHidden(req.targetId, req.action === 'hide');

    const resolved = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(reports)
        .set({ status: 'resolved', resolution: req.action, resolvedAt: sql`now()`, resolvedBy: moderatorId })
        .where(and(eq(reports.targetType, req.targetType), eq(reports.targetId, req.targetId), eq(reports.status, 'open')))
        .returning({ id: reports.id, reporterId: reports.reporterId });
      await this.audit.record(
        {
          action: 'moderation.action',
          actorUserId: moderatorId,
          meta,
          metadata: { targetType: req.targetType, targetId: req.targetId, action: req.action },
        },
        tx,
      );
      return rows;
    });

    await bestEffort(this.logger, 'report resolution notification', async () => {
      const inputs = resolved
        .filter((r): r is { id: string; reporterId: string } => r.reporterId !== null)
        .map((r) => ({
          userId: r.reporterId,
          category: 'system' as const,
          title: 'Signalement traité',
          body: 'Merci : votre signalement a été examiné par notre équipe.',
          data: { reportId: r.id },
        }));
      if (inputs.length > 0) await this.notifications.notifyMany(inputs);
    });
    return { resolvedReports: resolved.length };
  }
}
