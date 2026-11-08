import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminMiniAppListQuery,
  type CreateMiniAppRequest,
  type MiniApp,
  type MiniAppDirectoryQuery,
  type MiniAppList,
  type MiniAppPublic,
  type MiniAppPublicList,
  type MiniAppWithSecret,
  type PageQuery,
  type ReviewMiniAppRequest,
  type UpdateMiniAppRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';
import {
  APP_COLUMNS,
  type AppRow,
  appNotFound,
  newClientId,
  type PublicAppRow,
  randomToken,
  SECRET_PREFIX,
  textArray,
  sha256,
  toApp,
  toPublicApp,
} from './miniapps.shared.js';

type Executor = Pick<Db, 'execute'>;

const PUBLIC_SELECT = sql.raw(
  `a.id, a.org_id, a.name, a.description, a.icon_media_id, a.launch_url, a.redirect_uris, a.scopes, a.confidential, a.client_id,
   a.client_secret_hash, a.status, a.review_note, a.reviewed_at, a.published_at, a.created_at, a.updated_at,
   o.name AS org_name, o.verification_status AS org_verification`,
);

/** Developer applications owned by an organisation, their review, and the public directory. */
@Injectable()
export class MiniAppsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---- developer side (permission org.admins.manage, checked by OrgGuard) -------------------------

  private async checkIcon(tx: Executor, userId: string, mediaId: string | null | undefined): Promise<void> {
    if (!mediaId) return;
    const res = await tx.execute<{ id: string }>(sql`
      SELECT id FROM media_assets WHERE id = ${mediaId}::uuid AND owner_user_id = ${userId}::uuid AND status = 'ready' AND purpose = 'org_logo'`);
    if (res.rows.length === 0) throw validationError('iconMediaId', 'must be one of your ready "org_logo" media');
  }

  async create(orgId: string, userId: string, body: CreateMiniAppRequest, meta: RequestMeta): Promise<MiniAppWithSecret> {
    await this.checkIcon(this.db, userId, body.iconMediaId);
    const secret = body.confidential ? randomToken(SECRET_PREFIX) : null;
    const row = await this.db.transaction(async (tx) => {
      const res = await tx.execute<AppRow>(sql`
        INSERT INTO miniapps (org_id, created_by, name, description, icon_media_id, launch_url, redirect_uris, scopes, confidential, client_id, client_secret_hash)
        VALUES (${orgId}::uuid, ${userId}::uuid, ${body.name}, ${body.description ?? null}, ${body.iconMediaId ?? null}::uuid, ${body.launchUrl},
                ${textArray(body.redirectUris)}, ${textArray(body.scopes)}, ${body.confidential}, ${newClientId()}, ${secret ? sha256(secret) : null})
        RETURNING ${sql.raw(APP_COLUMNS)}`);
      const r = res.rows[0]!;
      await this.audit.record({ action: 'miniapp.created', actorUserId: userId, meta, metadata: { orgId, appId: r.id } }, tx);
      return r;
    });
    return { ...toApp(row), clientSecret: secret };
  }

  async listForOrg(orgId: string, q: PageQuery): Promise<MiniAppList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<AppRow & { ts: string }>(sql`
      SELECT ${sql.raw(APP_COLUMNS)}, created_at::text AS ts FROM miniapps
      WHERE org_id = ${orgId}::uuid
        ${cursor ? sql`AND (created_at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    return this.page(res.rows, q.limit, toApp);
  }

  private page<R extends { id: string; ts: string }, T>(rows: R[], limit: number, map: (r: R) => T): { items: T[]; nextCursor: string | null } {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(map), nextCursor: rows.length > limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  private async findOwned(tx: Executor, orgId: string, appId: string, lock = false): Promise<AppRow> {
    const res = await tx.execute<AppRow>(sql`
      SELECT ${sql.raw(APP_COLUMNS)} FROM miniapps WHERE id = ${appId}::uuid AND org_id = ${orgId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`);
    const row = res.rows[0];
    if (!row) throw appNotFound();
    return row;
  }

  async getForOrg(orgId: string, appId: string): Promise<MiniApp> {
    return toApp(await this.findOwned(this.db, orgId, appId));
  }

  /** Editable while draft or rejected (a rejected app goes back to draft). Review covers what is published, so a live app is frozen. */
  async update(orgId: string, appId: string, userId: string, patch: UpdateMiniAppRequest, meta: RequestMeta): Promise<MiniApp> {
    await this.checkIcon(this.db, userId, patch.iconMediaId);
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.findOwned(tx, orgId, appId, true);
      if (cur.status !== 'draft' && cur.status !== 'rejected') {
        throw AppError.conflict('Application cannot be edited in its current status', { reason: 'app_locked', status: cur.status });
      }
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET
          name = ${patch.name ?? cur.name},
          description = ${patch.description === undefined ? cur.description : patch.description},
          icon_media_id = ${patch.iconMediaId === undefined ? cur.icon_media_id : patch.iconMediaId}::uuid,
          launch_url = ${patch.launchUrl ?? cur.launch_url},
          redirect_uris = ${textArray(patch.redirectUris ?? cur.redirect_uris)},
          scopes = ${textArray(patch.scopes ?? cur.scopes)},
          status = 'draft'
        WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      await this.audit.record({ action: 'miniapp.updated', actorUserId: userId, meta, metadata: { orgId, appId, fields: Object.keys(patch) } }, tx);
      return res.rows[0]!;
    });
    return toApp(row);
  }

  async submit(orgId: string, appId: string, userId: string, meta: RequestMeta): Promise<MiniApp> {
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.findOwned(tx, orgId, appId, true);
      if (cur.status !== 'draft' && cur.status !== 'rejected') {
        throw AppError.conflict('Only a draft or rejected application can be submitted', { reason: 'invalid_transition', status: cur.status });
      }
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET status = 'in_review', review_note = NULL WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      await this.audit.record({ action: 'miniapp.submitted', actorUserId: userId, meta, metadata: { orgId, appId } }, tx);
      return res.rows[0]!;
    });
    return toApp(row);
  }

  /** The previous secret stops working at once; tokens already issued stay valid (they do not carry the secret). */
  async rotateSecret(orgId: string, appId: string, userId: string, meta: RequestMeta): Promise<MiniAppWithSecret> {
    const secret = randomToken(SECRET_PREFIX);
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.findOwned(tx, orgId, appId, true);
      if (!cur.confidential) throw AppError.conflict('A public client has no secret', { reason: 'public_client' });
      const res = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET client_secret_hash = ${sha256(secret)} WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      await this.audit.record({ action: 'miniapp.secret_rotated', actorUserId: userId, meta, metadata: { orgId, appId } }, tx);
      return res.rows[0]!;
    });
    return { ...toApp(row), clientSecret: secret };
  }

  // ---- back-office --------------------------------------------------------------------------------

  async listForAdmin(q: AdminMiniAppListQuery): Promise<MiniAppList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<AppRow & { ts: string }>(sql`
      SELECT ${sql.raw(APP_COLUMNS)}, created_at::text AS ts FROM miniapps
      WHERE true
        ${q.status ? sql`AND status = ${q.status}` : sql``}
        ${cursor ? sql`AND (created_at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    return this.page(res.rows, q.limit, toApp);
  }

  async review(appId: string, reviewerId: string, body: ReviewMiniAppRequest, meta: RequestMeta): Promise<MiniApp> {
    const transitions: Record<ReviewMiniAppRequest['decision'], { from: MiniApp['status']; to: MiniApp['status'] }> = {
      approve: { from: 'in_review', to: 'published' },
      reject: { from: 'in_review', to: 'rejected' },
      suspend: { from: 'published', to: 'suspended' },
      reinstate: { from: 'suspended', to: 'published' },
    };
    const t = transitions[body.decision];
    const row = await this.db.transaction(async (tx) => {
      const res = await tx.execute<AppRow>(sql`SELECT ${sql.raw(APP_COLUMNS)} FROM miniapps WHERE id = ${appId}::uuid FOR UPDATE`);
      const cur = res.rows[0];
      if (!cur) throw appNotFound();
      if (cur.status !== t.from) {
        throw AppError.conflict('This decision does not apply to the application status', { reason: 'invalid_transition', status: cur.status });
      }
      const upd = await tx.execute<AppRow>(sql`
        UPDATE miniapps SET status = ${t.to}, review_note = ${body.note ?? null}, reviewed_by = ${reviewerId}::uuid, reviewed_at = now(),
          published_at = CASE WHEN ${t.to}::text = 'published' AND published_at IS NULL THEN now() ELSE published_at END
        WHERE id = ${appId}::uuid RETURNING ${sql.raw(APP_COLUMNS)}`);
      if (t.to === 'suspended') {
        await tx.execute(sql`UPDATE miniapp_tokens SET revoked_at = now() WHERE app_id = ${appId}::uuid AND revoked_at IS NULL`);
        await tx.execute(sql`UPDATE miniapp_payment_requests SET status = 'cancelled', decided_at = now() WHERE app_id = ${appId}::uuid AND status = 'pending'`);
      }
      await this.audit.record(
        { action: 'miniapp.reviewed', actorUserId: reviewerId, meta, metadata: { appId, orgId: cur.org_id, decision: body.decision, from: t.from, to: t.to } },
        tx,
      );
      return upd.rows[0]!;
    });
    return toApp(row);
  }

  // ---- directory (published apps of active organisations only) -------------------------------------

  async directory(q: MiniAppDirectoryQuery): Promise<MiniAppPublicList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const res = await this.db.execute<PublicAppRow & { ts: string }>(sql`
      SELECT ${PUBLIC_SELECT}, a.created_at::text AS ts FROM miniapps a JOIN organizations o ON o.id = a.org_id
      WHERE a.status = 'published' AND o.status = 'active'
        ${like ? sql`AND (a.name ILIKE ${like} OR a.description ILIKE ${like})` : sql``}
        ${cursor ? sql`AND (a.created_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    return this.page(res.rows, q.limit, toPublicApp);
  }

  async publicDetail(appId: string): Promise<MiniAppPublic> {
    const res = await this.db.execute<PublicAppRow>(sql`
      SELECT ${PUBLIC_SELECT} FROM miniapps a JOIN organizations o ON o.id = a.org_id
      WHERE a.id = ${appId}::uuid AND a.status = 'published' AND o.status = 'active'`);
    const row = res.rows[0];
    if (!row) throw appNotFound();
    return toPublicApp(row);
  }
}
