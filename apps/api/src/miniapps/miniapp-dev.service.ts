import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminMiniAppVersionListQuery,
  type CertifyMiniAppRequest,
  type CreateMiniAppVersionRequest,
  type MiniApp,
  type MiniAppList,
  type MiniAppScope,
  type MiniAppStats,
  type MiniAppStatsQuery,
  type MiniAppVersion,
  type MiniAppVersionList,
  type MiniAppVersionListQuery,
  type ReviewMiniAppVersionRequest,
  type SetMiniAppQuotaRequest,
  type SetRevenueShareRequest,
  manifestNeedsReconsent,
  readManifest,
  validateManifest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { type OrgPermissionKey, roleHasPermission } from '../orgs/org-permissions.js';
import { decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';
import { MiniAppUsageService } from './miniapp-usage.service.js';
import { APP_COLUMNS, type AppRow, appNotFound, iso, jsonbOf, manifestError, textArray, toApp } from './miniapps.shared.js';

type Executor = Pick<Db, 'execute'>;
const MANAGE: OrgPermissionKey = 'org.admins.manage';

type VersionRow = {
  id: string;
  miniapp_id: string;
  version: string;
  changelog: string | null;
  scopes_requested: string[];
  manifest: unknown;
  app_manifest: unknown;
  status: MiniAppVersion['status'];
  review_note: string | null;
  submitted_at: string | Date | null;
  reviewed_at: string | Date | null;
  created_at: string | Date;
  app_scopes: string[];
  ts?: string;
};

const VERSION_SELECT = sql.raw(
  `v.id, v.miniapp_id, v.version, v.changelog, v.scopes_requested, v.manifest, a.manifest AS app_manifest, v.status, v.review_note, v.submitted_at, v.reviewed_at, v.created_at, a.scopes AS app_scopes`,
);

function toVersion(r: VersionRow): MiniAppVersion {
  // "Added" only matters until the version is decided: once approved the app declares exactly its scopes.
  const pending = r.status === 'draft' || r.status === 'submitted';
  return {
    id: r.id,
    appId: r.miniapp_id,
    version: r.version,
    changelog: r.changelog,
    scopes: r.scopes_requested as MiniAppScope[],
    manifest: r.manifest ?? null,
    needsReconsent: pending ? needsReconsent(r) : false,
    addedScopes: (pending ? r.scopes_requested.filter((s) => !r.app_scopes.includes(s)) : []) as MiniAppScope[],
    status: r.status,
    reviewNote: r.review_note,
    submittedAt: r.submitted_at ? iso(r.submitted_at) : null,
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
    createdAt: iso(r.created_at),
  };
}

/** True when approving this version would require users to consent again (scopes, data, costs or data location). */
function needsReconsent(r: VersionRow): boolean {
  const next = readManifest(r.manifest);
  return r.scopes_requested.some((s) => !r.app_scopes.includes(s)) || (next !== null && manifestNeedsReconsent(readManifest(r.app_manifest), next));
}

/** Developer portal: my applications, versions, statistics; back-office review of versions and quota override. */
@Injectable()
export class MiniAppDevService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly usage: MiniAppUsageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The app, if the caller holds `org.admins.manage` in its organisation; otherwise it does not exist for them (404). Writes need an active organisation. */
  async ownedApp(userId: string, appId: string, write: boolean, tx: Executor = this.db, lock = false): Promise<AppRow> {
    const res = await tx.execute<AppRow & { role: Parameters<typeof roleHasPermission>[0]; org_status: string }>(sql`
      SELECT ${sql.raw(APP_COLUMNS.split(', ').map((c) => `a.${c}`).join(', '))}, m.role, o.status AS org_status
      FROM miniapps a JOIN organizations o ON o.id = a.org_id
      JOIN org_members m ON m.org_id = a.org_id AND m.user_id = ${userId}::uuid AND m.status = 'active'
      WHERE a.id = ${appId}::uuid ${lock ? sql`FOR UPDATE OF a` : sql``}`);
    const row = res.rows[0];
    if (!row || !roleHasPermission(row.role, MANAGE)) throw appNotFound();
    if (write && row.org_status !== 'active') throw AppError.forbidden('This organization is suspended');
    return row;
  }

  /** Applications of every organisation where the caller is an owner (at most 100, newest first). */
  async myApps(userId: string): Promise<MiniAppList> {
    const res = await this.db.execute<AppRow & { role: Parameters<typeof roleHasPermission>[0] }>(sql`
      SELECT ${sql.raw(APP_COLUMNS.split(', ').map((c) => `a.${c}`).join(', '))}, m.role
      FROM miniapps a JOIN org_members m ON m.org_id = a.org_id AND m.user_id = ${userId}::uuid AND m.status = 'active'
      ORDER BY a.created_at DESC, a.id DESC LIMIT 300`);
    return { items: res.rows.filter((r) => roleHasPermission(r.role, MANAGE)).slice(0, 100).map(toApp), nextCursor: null };
  }

  // ---- versions (owner) -----------------------------------------------------------------------------

  async createVersion(userId: string, appId: string, body: CreateMiniAppVersionRequest, meta: RequestMeta): Promise<MiniAppVersion> {
    const app = await this.ownedApp(userId, appId, true);
    const scopes = body.scopes ?? (app.scopes as MiniAppScope[]);
    const manifest = body.manifest === undefined ? app.manifest : body.manifest;
    // A manifest given now must already be coherent with the version's scopes; a missing one is only refused at submission.
    if (body.manifest !== undefined) {
      const v = validateManifest(body.manifest, scopes);
      if (!v.ok) throw manifestError(v.problems);
    }
    const row = await this.db.transaction(async (tx) => {
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO miniapp_versions (miniapp_id, version, changelog, scopes_requested, manifest, created_by)
        VALUES (${appId}::uuid, ${body.version}, ${body.changelog ?? null}, ${textArray(scopes)}, ${jsonbOf(manifest)}, ${userId}::uuid)
        ON CONFLICT (miniapp_id, version) DO NOTHING RETURNING id`);
      const id = ins.rows[0]?.id;
      if (!id) throw AppError.conflict('This version already exists', { reason: 'version_exists' });
      await this.audit.record({ action: 'miniapp.version_created', actorUserId: userId, meta, metadata: { appId, versionId: id, version: body.version, scopes } }, tx);
      return this.loadVersion(tx, id);
    });
    return toVersion(row);
  }

  async listVersions(userId: string, appId: string, q: MiniAppVersionListQuery): Promise<MiniAppVersionList> {
    await this.ownedApp(userId, appId, false);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<VersionRow & { ts: string }>(sql`
      SELECT ${VERSION_SELECT}, v.created_at::text AS ts FROM miniapp_versions v JOIN miniapps a ON a.id = v.miniapp_id
      WHERE v.miniapp_id = ${appId}::uuid
        ${cursor ? sql`AND (v.created_at, v.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY v.created_at DESC, v.id DESC LIMIT ${q.limit + 1}`);
    return this.page(res.rows, q.limit);
  }

  private page(rows: (VersionRow & { ts: string })[], limit: number): MiniAppVersionList {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(toVersion), nextCursor: rows.length > limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  private async loadVersion(tx: Executor, versionId: string, lock = false): Promise<VersionRow> {
    const res = await tx.execute<VersionRow>(sql`
      SELECT ${VERSION_SELECT} FROM miniapp_versions v JOIN miniapps a ON a.id = v.miniapp_id WHERE v.id = ${versionId}::uuid ${lock ? sql`FOR UPDATE OF v` : sql``}`);
    const row = res.rows[0];
    if (!row) throw AppError.notFound('Version not found');
    return row;
  }

  async submitVersion(userId: string, appId: string, versionId: string, meta: RequestMeta): Promise<MiniAppVersion> {
    const row = await this.db.transaction(async (tx) => {
      const app = await this.ownedApp(userId, appId, true, tx, true);
      if (app.status === 'suspended') throw AppError.conflict('A suspended application cannot submit a version', { reason: 'app_suspended' });
      const cur = await this.loadVersion(tx, versionId, true);
      if (cur.miniapp_id !== appId) throw AppError.notFound('Version not found');
      if (cur.status !== 'draft') throw AppError.conflict('Only a draft version can be submitted', { reason: 'invalid_transition', status: cur.status });
      const mv = validateManifest(cur.manifest, cur.scopes_requested);
      if (!mv.ok) throw manifestError(mv.problems);
      await tx.execute(sql`UPDATE miniapp_versions SET status = 'submitted', submitted_at = now(), review_note = NULL WHERE id = ${versionId}::uuid`);
      await this.audit.record({ action: 'miniapp.version_submitted', actorUserId: userId, meta, metadata: { appId, versionId, version: cur.version } }, tx);
      return this.loadVersion(tx, versionId);
    });
    return toVersion(row);
  }

  // ---- statistics (owner) ---------------------------------------------------------------------------

  async stats(userId: string, appId: string, q: MiniAppStatsQuery): Promise<MiniAppStats> {
    await this.ownedApp(userId, appId, false);
    return this.usage.stats(appId, q.days);
  }

  // ---- back-office ----------------------------------------------------------------------------------

  async listForReview(q: AdminMiniAppVersionListQuery): Promise<MiniAppVersionList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<VersionRow & { ts: string }>(sql`
      SELECT ${VERSION_SELECT}, v.created_at::text AS ts FROM miniapp_versions v JOIN miniapps a ON a.id = v.miniapp_id
      WHERE v.status = ${q.status}
        ${cursor ? sql`AND (v.created_at, v.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY v.created_at DESC, v.id DESC LIMIT ${q.limit + 1}`);
    return this.page(res.rows, q.limit);
  }

  /**
   * Approval makes the version current: the app declares exactly its scopes from now on and the previous approved version
   * becomes `superseded`. Scopes the user already consented to do not change (the grant keeps what was consented); when the
   * version ADDS scopes, every live grant is flagged `reconsent_required` and the new scopes are only usable after a fresh consent.
   */
  async approveVersion(versionId: string, reviewerId: string, body: ReviewMiniAppVersionRequest, meta: RequestMeta): Promise<MiniAppVersion> {
    const row = await this.db.transaction(async (tx) => {
      const pre = await this.loadVersion(tx, versionId);
      const app = await tx.execute<{ status: string; scopes: string[]; org_id: string }>(sql`SELECT status, scopes, org_id FROM miniapps WHERE id = ${pre.miniapp_id}::uuid FOR UPDATE`);
      const a = app.rows[0]!;
      const cur = await this.loadVersion(tx, versionId, true);
      if (cur.status !== 'submitted') throw AppError.conflict('Only a submitted version can be reviewed', { reason: 'invalid_transition', status: cur.status });
      if (a.status === 'suspended') throw AppError.conflict('The application is suspended', { reason: 'app_suspended' });
      const added = cur.scopes_requested.filter((s) => !a.scopes.includes(s));
      const reconsent = needsReconsent(cur);
      await tx.execute(sql`UPDATE miniapp_versions SET status = 'superseded' WHERE miniapp_id = ${cur.miniapp_id}::uuid AND status = 'approved'`);
      await tx.execute(sql`
        UPDATE miniapp_versions SET status = 'approved', review_note = ${body.note ?? null}, reviewed_by = ${reviewerId}::uuid, reviewed_at = now() WHERE id = ${versionId}::uuid`);
      await tx.execute(sql`UPDATE miniapps SET scopes = ${textArray(cur.scopes_requested)}, current_version = ${cur.version}, manifest = ${jsonbOf(cur.manifest)} WHERE id = ${cur.miniapp_id}::uuid`);
      if (reconsent) {
        await tx.execute(sql`UPDATE miniapp_grants SET reconsent_required = true, updated_at = now() WHERE app_id = ${cur.miniapp_id}::uuid AND revoked_at IS NULL`);
      }
      await this.audit.record(
        { action: 'miniapp.version_reviewed', actorUserId: reviewerId, meta, metadata: { appId: cur.miniapp_id, orgId: a.org_id, versionId, version: cur.version, decision: 'approve', addedScopes: added, reconsent } },
        tx,
      );
      return this.loadVersion(tx, versionId);
    });
    // Users whose consent no longer covers the new version hear about it (generic text).
    const people = await this.db.execute<{ user_id: string; name: string }>(sql`
      SELECT g.user_id, a.name FROM miniapp_grants g JOIN miniapps a ON a.id = g.app_id
      WHERE g.app_id = ${row.miniapp_id}::uuid AND g.revoked_at IS NULL AND g.reconsent_required AND g.updated_at >= now() - interval '1 minute'`);
    await this.notifications
      .notifyMany(people.rows.map((p) => ({ userId: p.user_id, category: 'system' as const, title: 'Nouveau consentement demandé', body: `${p.name} a changé ses accès, ses données ou ses coûts : vérifiez et autorisez de nouveau.`, data: { kind: 'miniapp_reconsent', appId: row.miniapp_id } })))
      .catch(() => undefined);
    return toVersion(row);
  }

  async rejectVersion(versionId: string, reviewerId: string, body: ReviewMiniAppVersionRequest, meta: RequestMeta): Promise<MiniAppVersion> {
    if (!body.note) throw validationError('note', 'a note is required to reject');
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.loadVersion(tx, versionId, true);
      if (cur.status !== 'submitted') throw AppError.conflict('Only a submitted version can be reviewed', { reason: 'invalid_transition', status: cur.status });
      await tx.execute(sql`
        UPDATE miniapp_versions SET status = 'rejected', review_note = ${body.note}, reviewed_by = ${reviewerId}::uuid, reviewed_at = now() WHERE id = ${versionId}::uuid`);
      await this.audit.record(
        { action: 'miniapp.version_reviewed', actorUserId: reviewerId, meta, metadata: { appId: cur.miniapp_id, versionId, version: cur.version, decision: 'reject' } },
        tx,
      );
      return this.loadVersion(tx, versionId);
    });
    return toVersion(row);
  }

  /** Per-application override of the per-minute call budget (null restores the platform default). */
  async setQuota(appId: string, adminId: string, body: SetMiniAppQuotaRequest, meta: RequestMeta): Promise<MiniApp> {
    const row = await this.db.transaction(async (tx) => {
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET rate_limit_per_minute = ${body.rateLimitPerMinute} WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      const r = res.rows[0];
      if (!r) throw appNotFound();
      await this.audit.record({ action: 'miniapp.quota_set', actorUserId: adminId, meta, metadata: { appId, orgId: r.org_id, rateLimitPerMinute: body.rateLimitPerMinute } }, tx);
      return r;
    });
    return toApp(row);
  }

  /** Certification: only a published application; the note and date are shown with the badge. */
  async certify(appId: string, adminId: string, body: CertifyMiniAppRequest, meta: RequestMeta): Promise<MiniApp> {
    const row = await this.db.transaction(async (tx) => {
      const cur = await tx.execute<AppRow>(sql`SELECT ${sql.raw(APP_COLUMNS)} FROM miniapps WHERE id = ${appId}::uuid FOR UPDATE`);
      if (!cur.rows[0]) throw appNotFound();
      if (cur.rows[0].status !== 'published') throw AppError.conflict('Only a published application can be certified', { reason: 'not_published', status: cur.rows[0].status });
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET certified_at = now(), certified_by = ${adminId}::uuid, certification_note = ${body.note} WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      await this.audit.record({ action: 'miniapp.certified', actorUserId: adminId, meta, metadata: { appId, orgId: cur.rows[0].org_id } }, tx);
      return res.rows[0]!;
    });
    await this.tellOwners(row, 'Application certifiée', `${row.name} a reçu la certification CASELIND.`);
    return toApp(row);
  }

  async decertify(appId: string, adminId: string, meta: RequestMeta): Promise<MiniApp> {
    const row = await this.db.transaction(async (tx) => {
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET certified_at = NULL, certified_by = NULL, certification_note = NULL WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      const r = res.rows[0];
      if (!r) throw appNotFound();
      await this.audit.record({ action: 'miniapp.decertified', actorUserId: adminId, meta, metadata: { appId, orgId: r.org_id } }, tx);
      return r;
    });
    await this.tellOwners(row, 'Certification retirée', `La certification de ${row.name} a été retirée.`);
    return toApp(row);
  }

  private async tellOwners(app: AppRow, title: string, body: string): Promise<void> {
    const owners = await this.db.execute<{ user_id: string }>(sql`SELECT user_id FROM org_members WHERE org_id = ${app.org_id}::uuid AND role = 'owner' AND status = 'active'`);
    await this.notifications
      .notifyMany(owners.rows.map((o) => ({ userId: o.user_id, category: 'system' as const, title, body, data: { kind: 'miniapp_status', appId: app.id } })))
      .catch(() => undefined);
  }

  /** Platform share of the (indicative) revenue statements, in basis points, 0 to 3000. */
  async setRevenueShare(appId: string, adminId: string, body: SetRevenueShareRequest, meta: RequestMeta): Promise<MiniApp> {
    const row = await this.db.transaction(async (tx) => {
      const res = await tx.execute<AppRow>(sql`UPDATE miniapps SET revenue_share_bps = ${body.revenueShareBps} WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      const r = res.rows[0];
      if (!r) throw appNotFound();
      await this.audit.record({ action: 'miniapp.revenue_share_set', actorUserId: adminId, meta, metadata: { appId, orgId: r.org_id, revenueShareBps: body.revenueShareBps } }, tx);
      return r;
    });
    return toApp(row);
  }
}
