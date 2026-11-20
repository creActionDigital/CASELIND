import { Inject, Injectable } from '@nestjs/common';
import type { AdminWalletAlert, AdminWalletAlertList, AdminWalletAlertsQuery, PageQuery, WalletAlert, WalletAlertList } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import type { AuthUser } from '../security/auth.guard.js';
import { decodeCursor, encodeCursor, iso, UUID_RE } from './wallet-finance.shared.js';

type AlertRow = {
  id: string;
  user_id: string;
  rule: WalletAlert['rule'];
  severity: WalletAlert['severity'];
  transfer_id: string | null;
  status: WalletAlert['status'];
  reported_at: Date | null;
  created_at: Date;
  created_text: string;
  display_name: string;
  handle: string;
};

const SELECT = sql`
  SELECT a.id, a.user_id, a.rule, a.severity, a.transfer_id, a.status, a.reported_at, a.created_at, a.created_at::text AS created_text,
    u.display_name, u.handle::text AS handle
  FROM wallet_alerts a JOIN users u ON u.id = a.user_id`;

const toAlert = (r: AlertRow): WalletAlert => ({
  mode: 'sandbox',
  id: r.id,
  rule: r.rule,
  severity: r.severity,
  transferId: r.transfer_id,
  status: r.status,
  reported: r.reported_at !== null,
  createdAt: iso(r.created_at),
});

/** Anomaly alerts (information only). "This is me" dismisses; "this is not me" is reported to the admins, who decide about a freeze. */
@Injectable()
export class WalletAlertsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(me: string, q: PageQuery): Promise<WalletAlertList> {
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<AlertRow>(sql`
      ${SELECT} WHERE a.user_id = ${me}::uuid ${cur ? sql`AND (a.created_at, a.id) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)` : sql``}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    return { mode: 'sandbox', items: page.map(toAlert), nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.created_text, page.at(-1)!.id) : null };
  }

  confirmMine(auth: AuthUser, id: string, meta: RequestMeta): Promise<WalletAlert> {
    return this.answer(auth, id, 'dismissed', false, 'wallet.alert_confirmed', meta);
  }

  report(auth: AuthUser, id: string, meta: RequestMeta): Promise<WalletAlert> {
    return this.answer(auth, id, 'reviewed', true, 'wallet.alert_reported', meta);
  }

  private async answer(auth: AuthUser, id: string, status: 'dismissed' | 'reviewed', reported: boolean, action: 'wallet.alert_confirmed' | 'wallet.alert_reported', meta: RequestMeta): Promise<WalletAlert> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Alert not found');
    await this.db.transaction(async (tx) => {
      const u = await tx.execute(sql`
        UPDATE wallet_alerts SET status = ${status}, reported_at = ${reported ? sql`now()` : sql`NULL`}
        WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid AND status = 'open' RETURNING id`);
      if (u.rows.length === 0) {
        const e = await tx.execute<{ status: string }>(sql`SELECT status FROM wallet_alerts WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid`);
        if (!e.rows[0]) throw AppError.notFound('Alert not found');
        throw AppError.conflict('This alert was already answered', { reason: 'alert_closed', status: e.rows[0].status });
      }
      await this.audit.record({ action, actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { alertId: id } }, tx);
    });
    const res = await this.db.execute<AlertRow>(sql`${SELECT} WHERE a.id = ${id}::uuid`);
    return toAlert(res.rows[0]!);
  }

  /* ---------------------------------------------------------------- back-office */

  async adminList(q: AdminWalletAlertsQuery): Promise<AdminWalletAlertList> {
    const filters = [sql`true`];
    if (q.status) filters.push(sql`a.status = ${q.status}`);
    if (q.reported === 'true') filters.push(sql`a.reported_at IS NOT NULL`);
    if (q.reported === 'false') filters.push(sql`a.reported_at IS NULL`);
    if (q.cursor) {
      const [at, id] = decodeCursor(q.cursor);
      filters.push(sql`(a.created_at, a.id) < (${at}::timestamptz, ${id}::uuid)`);
    }
    const res = await this.db.execute<AlertRow>(sql`${SELECT} WHERE ${sql.join(filters, sql` AND `)} ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    return {
      mode: 'sandbox',
      items: page.map((r): AdminWalletAlert => ({ ...toAlert(r), user: { userId: r.user_id, displayName: r.display_name, handle: r.handle } })),
      nextCursor: res.rows.length > q.limit ? encodeCursor(page.at(-1)!.created_text, page.at(-1)!.id) : null,
    };
  }

  /** An admin marks an open alert as handled. */
  async adminReview(admin: AuthUser, id: string, meta: RequestMeta): Promise<AdminWalletAlert> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Alert not found');
    const u = await this.db.execute<{ user_id: string }>(sql`UPDATE wallet_alerts SET status = 'reviewed' WHERE id = ${id}::uuid AND status IN ('open', 'reviewed') RETURNING user_id`);
    if (u.rows[0]) {
      await this.audit.record({ action: 'wallet.alert_reviewed', actorUserId: admin.userId, subjectUserId: u.rows[0].user_id, sessionId: admin.sessionId, meta, metadata: { alertId: id } });
    }
    const res = await this.db.execute<AlertRow>(sql`${SELECT} WHERE a.id = ${id}::uuid`);
    const r = res.rows[0];
    if (!r) throw AppError.notFound('Alert not found');
    return { ...toAlert(r), user: { userId: r.user_id, displayName: r.display_name, handle: r.handle } };
  }
}
