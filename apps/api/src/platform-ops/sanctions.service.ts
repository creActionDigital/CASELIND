import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminAppeal,
  type AdminAppealList,
  type AdminAppealListQuery,
  type AppealRequest,
  type DecideAppealRequest,
  type IssueSanctionRequest,
  type LiftSanctionRequest,
  type Sanction,
  type SanctionKind,
  type SanctionList,
  type SanctionListQuery,
  type ExportedSanction,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../stories/cursor.js';
import { moderatorMayHandle, sanctionVerdict } from './sanctions.logic.js';

type Tx = Pick<Db, 'execute' | 'insert'>;
export interface Actor {
  userId: string;
  roles: readonly string[];
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
/** Statut lu : une sanction dont la fin est passée se lit `expired` avant même le passage de la maintenance. */
const EFFECTIVE = sql`CASE WHEN s.status IN ('active', 'appealed') AND s.ends_at IS NOT NULL AND s.ends_at <= now() THEN 'expired' ELSE s.status END`;
const IN_FORCE = sql`s.status IN ('active', 'appealed') AND (s.ends_at IS NULL OR s.ends_at > now())`;

interface SanctionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  handle: string | null;
  kind: SanctionKind;
  reason: string;
  report_id: string | null;
  issued_by: string;
  starts_at: Date;
  ends_at: Date | null;
  status: Sanction['status'];
  lifted_at: Date | null;
  created_at: Date;
  ts: string;
  appeal_id: string | null;
  appeal_status: 'pending' | 'accepted' | 'rejected' | null;
  appeal_note: string | null;
}

const SANCTION_SELECT = sql`
  SELECT s.id, s.user_id, u.handle::text AS handle, s.kind, s.reason, s.report_id, s.issued_by, s.starts_at, s.ends_at,
         (${EFFECTIVE}) AS status, s.lifted_at, s.created_at, s.created_at::text AS ts,
         a.id AS appeal_id, a.status AS appeal_status, a.decision_note AS appeal_note
  FROM user_sanctions s JOIN users u ON u.id = s.user_id LEFT JOIN sanction_appeals a ON a.sanction_id = s.id`;

const toSanction = (r: SanctionRow, admin: boolean): Sanction => ({
  id: r.id,
  userId: r.user_id,
  userHandle: admin ? r.handle : null,
  kind: r.kind,
  reason: r.reason,
  reportId: r.report_id,
  issuedBy: admin ? r.issued_by : null,
  startsAt: iso(r.starts_at)!,
  endsAt: iso(r.ends_at),
  status: r.status,
  liftedAt: iso(r.lifted_at),
  appeal: r.appeal_id ? { id: r.appeal_id, status: r.appeal_status!, decisionNote: r.appeal_note } : null,
  createdAt: iso(r.created_at)!,
});

/**
 * Sanctions graduées et recours (CDC §26). Les effets sont appliqués ici, côté serveur :
 * - blocage de publication : lu par PublishGuard à chaque publication ;
 * - suspension temporaire et bannissement : le compte passe `suspended` (la session n'est plus acceptée), la fin de la sanction
 *   le réactive (levée manuelle, recours accepté, ou maintenance) seulement si CETTE sanction l'a suspendu et qu'aucune autre ne tient encore.
 * Les audits et notifications ne portent que des identifiants et des types, jamais le motif ni le message du recours.
 */
@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ émission */

  /** Cheap check before a request is queued: who may do what. `approval` means the caller must go through the double validation. */
  async plan(actor: Actor, targetId: string, body: IssueSanctionRequest, approvalActive: boolean): Promise<'direct' | 'approval'> {
    if (!UUID_RE.test(targetId)) throw AppError.notFound('User not found');
    const r = await this.db.execute<{ roles: string[] }>(sql`SELECT roles FROM users WHERE id = ${targetId}::uuid`);
    if (!r.rows[0]) throw AppError.notFound('User not found');
    const v = sanctionVerdict({ actorId: actor.userId, actorRoles: actor.roles, targetId, targetRoles: r.rows[0].roles, kind: body.kind, durationDays: body.durationDays, approvalActive });
    if (v.kind === 'refuse') throw v.reason === 'forbidden' ? AppError.forbidden() : AppError.conflict(v.reason === 'self' ? 'You cannot sanction yourself' : 'An administrator can only be sanctioned with a second approval', { reason: v.reason });
    return v.kind;
  }

  /**
   * `viaApproval`: runs after a second administrator approved (the actor is the requester, still an active administrator);
   * the staff / administrator checks were made when the request was queued.
   */
  async issue(actor: Actor, targetId: string, body: IssueSanctionRequest, meta: RequestMeta): Promise<Sanction> {
    const id = await this.issueTx(actor, targetId, body, meta, this.db, false);
    await this.notifyUser(targetId, id, 'Une mesure de modération a été appliquée à votre compte.');
    return this.one(id, true);
  }

  /** Same as `issue`, inside the caller's transaction (double validation); returns the id, no notification (nothing is committed yet). */
  async issueTx(actor: Actor, targetId: string, body: IssueSanctionRequest, meta: RequestMeta, exec: Pick<Db, 'transaction'>, viaApproval: boolean): Promise<string> {
    if (!UUID_RE.test(targetId)) throw AppError.notFound('User not found');
    return exec.transaction(async (tx) => {
      const r = await tx.execute<{ status: string; roles: string[] }>(sql`SELECT status::text AS status, roles FROM users WHERE id = ${targetId}::uuid FOR UPDATE`);
      const u = r.rows[0];
      if (!u) throw AppError.notFound('User not found');
      if (targetId === actor.userId) throw AppError.conflict('You cannot sanction yourself', { reason: 'self' });
      if (!viaApproval) {
        const v = sanctionVerdict({ actorId: actor.userId, actorRoles: actor.roles, targetId, targetRoles: u.roles, kind: body.kind, durationDays: body.durationDays, approvalActive: false });
        if (v.kind === 'refuse') throw v.reason === 'forbidden' ? AppError.forbidden() : AppError.conflict('An administrator can only be sanctioned with a second approval', { reason: v.reason });
      }
      if (u.status !== 'active' && u.status !== 'suspended') throw AppError.conflict('Only an active or suspended account can be sanctioned', { reason: 'bad_status', status: u.status });
      if (body.reportId) {
        const rep = await tx.execute(sql`SELECT 1 FROM reports WHERE id = ${body.reportId}::uuid`);
        if (rep.rows.length === 0) throw AppError.notFound('Report not found');
      }
      const ends = body.durationDays ? sql`now() + make_interval(days => ${body.durationDays}::int)` : sql`NULL`;
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO user_sanctions (user_id, kind, reason, report_id, issued_by, ends_at)
        VALUES (${targetId}::uuid, ${body.kind}, ${body.reason}, ${body.reportId ?? null}, ${actor.userId}::uuid, ${ends}) RETURNING id`);
      const sanctionId = ins.rows[0]!.id;
      if (body.kind === 'suspension_temp' || body.kind === 'ban') {
        const sus = await tx.execute(sql`UPDATE users SET status = 'suspended' WHERE id = ${targetId}::uuid AND status = 'active'`);
        if ((sus.rowCount ?? 0) > 0) await tx.execute(sql`UPDATE user_sanctions SET suspended_user = true WHERE id = ${sanctionId}::uuid`);
      }
      await this.audit.record({ action: 'admin.sanction_issued', actorUserId: actor.userId, subjectUserId: targetId, meta, metadata: { sanctionId, kind: body.kind, ...(body.durationDays ? { durationDays: body.durationDays } : {}), ...(body.reportId ? { reportId: body.reportId } : {}) } }, tx);
      return sanctionId;
    });
  }

  /* ------------------------------------------------------------------ levée */

  async lift(actor: Actor, sanctionId: string, body: LiftSanctionRequest, meta: RequestMeta): Promise<Sanction> {
    const userId = await this.db.transaction(async (tx) => {
      const s = await this.lock(tx, sanctionId);
      if (s.user_id === actor.userId) throw AppError.conflict('You cannot lift your own sanction', { reason: 'self' });
      if (!actor.roles.includes('admin') && !moderatorMayHandle(s.kind)) throw AppError.forbidden();
      if (!s.in_force) throw AppError.conflict('This sanction is no longer in force', { reason: 'not_active' });
      await this.liftRow(tx, s, actor.userId, body.note ?? null);
      await this.audit.record({ action: 'admin.sanction_lifted', actorUserId: actor.userId, subjectUserId: s.user_id, meta, metadata: { sanctionId, kind: s.kind } }, tx);
      return s.user_id;
    });
    await this.notifyUser(userId, sanctionId, 'Une mesure de modération a été levée sur votre compte.');
    return this.one(sanctionId, true);
  }

  private async lock(tx: Tx, id: string): Promise<{ id: string; user_id: string; kind: SanctionKind; in_force: boolean; suspended_user: boolean }> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Sanction not found');
    const r = await tx.execute<{ id: string; user_id: string; kind: SanctionKind; in_force: boolean; suspended_user: boolean }>(sql`
      SELECT s.id, s.user_id, s.kind, (${IN_FORCE}) AS in_force, s.suspended_user FROM user_sanctions s WHERE s.id = ${id}::uuid FOR UPDATE`);
    if (!r.rows[0]) throw AppError.notFound('Sanction not found');
    return r.rows[0];
  }

  /** Marks the sanction lifted, closes a pending appeal as accepted, and gives the account back when nothing else holds it. */
  private async liftRow(tx: Tx, s: { id: string; user_id: string; kind: SanctionKind }, by: string, note: string | null): Promise<void> {
    await tx.execute(sql`UPDATE user_sanctions SET status = 'lifted', lifted_by = ${by}::uuid, lifted_at = now() WHERE id = ${s.id}::uuid`);
    await tx.execute(sql`
      UPDATE sanction_appeals SET status = 'accepted', decided_by = ${by}::uuid, decided_at = now(), decision_note = ${note}
      WHERE sanction_id = ${s.id}::uuid AND status = 'pending'`);
    if (s.kind === 'suspension_temp' || s.kind === 'ban') await this.releaseSuspension(tx, [s.user_id]);
  }

  /** Reactivates accounts that a sanction suspended once no suspension or ban is in force any more (the flag is then cleared). */
  private async releaseSuspension(tx: Tx, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const ids = sql`ARRAY[${sql.join(userIds.map((i) => sql`${i}`), sql`, `)}]::uuid[]`;
    await tx.execute(sql`
      WITH r AS (
        UPDATE users u SET status = 'active'
        WHERE u.id = ANY(${ids}) AND u.status = 'suspended'
          AND EXISTS (SELECT 1 FROM user_sanctions f WHERE f.user_id = u.id AND f.suspended_user)
          AND NOT EXISTS (
            SELECT 1 FROM user_sanctions s WHERE s.user_id = u.id AND s.kind IN ('suspension_temp', 'ban') AND ${IN_FORCE})
        RETURNING u.id)
      UPDATE user_sanctions SET suspended_user = false WHERE user_id IN (SELECT id FROM r) AND suspended_user`);
  }

  /** Maintenance: sanctions whose end passed become `expired`; the accounts they suspended are given back. */
  async expireDue(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string; user_id: string; kind: SanctionKind }>(sql`
        UPDATE user_sanctions SET status = 'expired'
        WHERE status IN ('active', 'appealed') AND ends_at IS NOT NULL AND ends_at <= now()
        RETURNING id, user_id, kind`);
      const suspended = [...new Set(r.rows.filter((x) => x.kind === 'suspension_temp').map((x) => x.user_id))];
      await this.releaseSuspension(tx, suspended);
      for (const x of r.rows) await this.audit.record({ action: 'admin.sanction_expired', subjectUserId: x.user_id, metadata: { sanctionId: x.id, kind: x.kind } }, tx);
      return r.rows.length;
    });
  }

  /* ------------------------------------------------------------------ lecture */

  private async one(id: string, admin: boolean): Promise<Sanction> {
    const r = await this.db.execute<SanctionRow>(sql`${SANCTION_SELECT} WHERE s.id = ${id}::uuid`);
    return toSanction(r.rows[0]!, admin);
  }

  async list(q: SanctionListQuery, forUser: string | null, admin: boolean): Promise<SanctionList> {
    const userId = forUser ?? q.userId ?? null;
    const where = [sql`true`];
    if (userId) where.push(sql`s.user_id = ${userId}::uuid`);
    if (q.status) where.push(sql`(${EFFECTIVE}) = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(sql`(s.created_at, s.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const r = await this.db.execute<SanctionRow>(sql`${SANCTION_SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY s.created_at DESC, s.id DESC LIMIT ${q.limit + 1}`);
    const page = r.rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page.map((x) => toSanction(x, admin)), nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  /** Account export: the user's own sanctions and appeals. */
  async exportFor(userId: string): Promise<ExportedSanction[]> {
    const r = await this.db.execute<{ id: string; kind: SanctionKind; reason: string; status: Sanction['status']; starts_at: Date; ends_at: Date | null; created_at: Date; a_message: string | null; a_status: 'pending' | 'accepted' | 'rejected' | null; a_note: string | null; a_created: Date | null }>(sql`
      SELECT s.id, s.kind, s.reason, (${EFFECTIVE}) AS status, s.starts_at, s.ends_at, s.created_at,
             a.message AS a_message, a.status AS a_status, a.decision_note AS a_note, a.created_at AS a_created
      FROM user_sanctions s LEFT JOIN sanction_appeals a ON a.sanction_id = s.id
      WHERE s.user_id = ${userId}::uuid ORDER BY s.created_at, s.id`);
    return r.rows.map((x) => ({
      id: x.id,
      kind: x.kind,
      reason: x.reason,
      status: x.status,
      startsAt: iso(x.starts_at)!,
      endsAt: iso(x.ends_at),
      createdAt: iso(x.created_at)!,
      appeal: x.a_status ? { message: x.a_message!, status: x.a_status, decisionNote: x.a_note, createdAt: iso(x.a_created)! } : null,
    }));
  }

  /* ------------------------------------------------------------------ recours */

  async appeal(userId: string, sanctionId: string, body: AppealRequest, meta: RequestMeta): Promise<Sanction> {
    if (!UUID_RE.test(sanctionId)) throw AppError.notFound('Sanction not found');
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ status: string; in_force: boolean }>(sql`
        SELECT s.status, (${IN_FORCE}) AS in_force FROM user_sanctions s WHERE s.id = ${sanctionId}::uuid AND s.user_id = ${userId}::uuid FOR UPDATE`);
      const s = r.rows[0];
      if (!s) throw AppError.notFound('Sanction not found');
      const had = await tx.execute(sql`SELECT 1 FROM sanction_appeals WHERE sanction_id = ${sanctionId}::uuid`);
      if (had.rows.length > 0) throw AppError.conflict('This sanction already has an appeal', { reason: 'already_appealed' });
      if (!s.in_force || s.status !== 'active') throw AppError.conflict('This sanction can no longer be appealed', { reason: 'not_appealable' });
      const ins = await tx.execute<{ id: string }>(sql`INSERT INTO sanction_appeals (sanction_id, user_id, message) VALUES (${sanctionId}::uuid, ${userId}::uuid, ${body.message}) RETURNING id`);
      await tx.execute(sql`UPDATE user_sanctions SET status = 'appealed' WHERE id = ${sanctionId}::uuid`);
      await this.audit.record({ action: 'user.sanction_appealed', actorUserId: userId, meta, metadata: { sanctionId, appealId: ins.rows[0]!.id } }, tx);
    });
    return this.one(sanctionId, false);
  }

  async listAppeals(q: AdminAppealListQuery): Promise<AdminAppealList> {
    const where = [sql`true`];
    if (q.status) where.push(sql`a.status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(sql`(a.created_at, a.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const r = await this.db.execute<{ id: string; sanction_id: string; user_id: string; handle: string | null; message: string; status: AdminAppeal['status']; decision_note: string | null; decided_by: string | null; created_at: Date; ts: string; kind: SanctionKind; reason: string; s_status: Sanction['status'] }>(sql`
      SELECT a.id, a.sanction_id, a.user_id, u.handle::text AS handle, a.message, a.status, a.decision_note, a.decided_by, a.created_at, a.created_at::text AS ts,
             s.kind, s.reason, (${EFFECTIVE}) AS s_status
      FROM sanction_appeals a JOIN user_sanctions s ON s.id = a.sanction_id JOIN users u ON u.id = a.user_id
      WHERE ${sql.join(where, sql` AND `)} ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const page = r.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((x) => ({ id: x.id, sanctionId: x.sanction_id, userId: x.user_id, userHandle: x.handle, message: x.message, status: x.status, decisionNote: x.decision_note, decidedBy: x.decided_by, createdAt: iso(x.created_at)!, sanctionKind: x.kind, sanctionReason: x.reason, sanctionStatus: x.s_status })),
      nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /** Accepting lifts the sanction; rejecting puts it back to `active`. Nobody decides the appeal of their own sanction. */
  async decide(actor: Actor, appealId: string, body: DecideAppealRequest, meta: RequestMeta): Promise<AdminAppeal> {
    if (!UUID_RE.test(appealId)) throw AppError.notFound('Appeal not found');
    const out = await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string; sanction_id: string; user_id: string; status: string; kind: SanctionKind; in_force: boolean }>(sql`
        SELECT a.id, a.sanction_id, a.user_id, a.status, s.kind, (${IN_FORCE}) AS in_force
        FROM sanction_appeals a JOIN user_sanctions s ON s.id = a.sanction_id WHERE a.id = ${appealId}::uuid FOR UPDATE OF a, s`);
      const a = r.rows[0];
      if (!a) throw AppError.notFound('Appeal not found');
      if (a.user_id === actor.userId) throw AppError.conflict('You cannot decide the appeal of your own sanction', { reason: 'self' });
      if (!actor.roles.includes('admin') && !moderatorMayHandle(a.kind)) throw AppError.forbidden();
      if (a.status !== 'pending') throw AppError.conflict('This appeal was already decided', { reason: 'already_decided' });
      if (body.decision === 'accepted') {
        // liftRow closes the pending appeal as accepted, with the note.
        if (a.in_force) await this.liftRow(tx, { id: a.sanction_id, user_id: a.user_id, kind: a.kind }, actor.userId, body.note ?? null);
        else await tx.execute(sql`UPDATE sanction_appeals SET status = 'accepted', decided_by = ${actor.userId}::uuid, decided_at = now(), decision_note = ${body.note ?? null} WHERE id = ${appealId}::uuid`);
      } else {
        await tx.execute(sql`UPDATE sanction_appeals SET status = 'rejected', decided_by = ${actor.userId}::uuid, decided_at = now(), decision_note = ${body.note ?? null} WHERE id = ${appealId}::uuid`);
        await tx.execute(sql`UPDATE user_sanctions SET status = 'active' WHERE id = ${a.sanction_id}::uuid AND status = 'appealed'`);
      }
      await this.audit.record({ action: 'admin.appeal_decided', actorUserId: actor.userId, subjectUserId: a.user_id, meta, metadata: { appealId, sanctionId: a.sanction_id, decision: body.decision } }, tx);
      return a;
    });
    await this.notifyUser(out.user_id, out.sanction_id, 'Votre recours a été examiné.');
    return this.appealOne(appealId);
  }

  private async appealOne(id: string): Promise<AdminAppeal> {
    const r = await this.db.execute<{ id: string; sanction_id: string; user_id: string; handle: string | null; message: string; status: AdminAppeal['status']; decision_note: string | null; decided_by: string | null; created_at: Date; kind: SanctionKind; reason: string; s_status: Sanction['status'] }>(sql`
      SELECT a.id, a.sanction_id, a.user_id, u.handle::text AS handle, a.message, a.status, a.decision_note, a.decided_by, a.created_at, s.kind, s.reason, (${EFFECTIVE}) AS s_status
      FROM sanction_appeals a JOIN user_sanctions s ON s.id = a.sanction_id JOIN users u ON u.id = a.user_id WHERE a.id = ${id}::uuid`);
    const x = r.rows[0]!;
    return { id: x.id, sanctionId: x.sanction_id, userId: x.user_id, userHandle: x.handle, message: x.message, status: x.status, decisionNote: x.decision_note, decidedBy: x.decided_by, createdAt: iso(x.created_at)!, sanctionKind: x.kind, sanctionReason: x.reason, sanctionStatus: x.s_status };
  }

  private async notifyUser(userId: string, sanctionId: string, body: string): Promise<void> {
    await this.notifications
      .notify({ userId, category: 'system', title: 'CASELIND', body, data: { sanctionId } })
      .catch((err: unknown) => this.logger.warn(`sanction notification failed: ${(err as Error).name}`));
  }
}
