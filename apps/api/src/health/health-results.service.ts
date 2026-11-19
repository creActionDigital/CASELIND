import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  HEALTH_RESULTS_MAX,
  type CreateHealthResultRequest,
  type HealthResult,
  type HealthResultKind,
  type HealthResultList,
  type HealthResultListQuery,
  type MediaMime,
  type SharedResults,
  type UpdateHealthResultRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { assertOwnReady, deleteObjects, invalidAsset } from '../media/attachments.js';
import { contentUrlOf } from '../media/media.service.js';
import { MediaStorage } from '../media/storage.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { HealthCrypto } from './health-crypto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const consentRequired = () => new AppError(403, ErrorCodes.forbidden, 'Health data needs your explicit consent first', { reason: 'consent_required' });
const notFound = (what: string) => AppError.notFound(`${what} not found`);
const iso = (d: Date | string) => new Date(d).toISOString();
/** Per professional and patient / per day: a professional cannot fill the patient's quota nor flood them with notifications. */
export const PRO_RESULTS_PER_PATIENT = 20;
export const PRO_RESULTS_PER_DAY = 10;

type Tx = Pick<Db, 'execute'>;
type Payload = { title: string; summary: string };
type Row = {
  id: string;
  kind: HealthResultKind;
  payload: string;
  result_date: string; // `date` column read with to_char: no server time zone involved
  created_at: Date;
  media_id: string | null;
  provider_user_id: string | null;
  pro_name: string | null;
  m_id: string | null;
  m_mime: string | null;
  m_size: string | number | null;
};

const encodeCursor = (on: string, id: string) => Buffer.from(JSON.stringify([on, id])).toString('base64url');
function decodeCursor(cursor: string): { on: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v[0]) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { on: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}

/** An existing calendar day, not after tomorrow (UTC: leaves room for any local clock). */
function assertResultDate(value: string): void {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw invalid('resultDate', 'not a valid date');
  if (d.getTime() > Date.now() + DAY_MS) throw invalid('resultDate', 'cannot be in the future');
}

const SELECT = sql`
  SELECT r.id, r.kind, r.payload, to_char(r.result_date, 'YYYY-MM-DD') AS result_date, r.created_at, r.media_id, r.provider_user_id, pu.display_name AS pro_name,
         m.id AS m_id, m.mime AS m_mime, m.size_bytes AS m_size
  FROM health_results r LEFT JOIN users pu ON pu.id = r.provider_user_id
  LEFT JOIN media_assets m ON m.id = r.media_id AND m.status = 'ready'`;

/**
 * Exam results of the health record (lot 18d). Free text sealed with the patient's health key; the report file is a media of
 * purpose `health_result` owned by the patient. Entered by the patient, or by an approved professional who has a confirmed or
 * completed appointment with them. A professional reads them only through an active share covering `results`; each read is
 * logged for the patient. Audit rows carry ids and the kind, never content.
 */
@Injectable()
export class HealthResultsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly crypto: HealthCrypto,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: MediaStorage,
  ) {}

  private toResult(patientId: string, r: Row): HealthResult {
    const p = this.crypto.open<Payload>(patientId, r.payload);
    return {
      id: r.id,
      kind: r.kind,
      title: p.title,
      summary: p.summary,
      resultDate: r.result_date,
      provider: r.provider_user_id && r.pro_name !== null ? { id: r.provider_user_id, displayName: r.pro_name } : null,
      file: r.m_id ? { id: r.m_id, mime: r.m_mime as MediaMime, sizeBytes: Number(r.m_size), contentUrl: contentUrlOf(r.m_id) } : null,
      createdAt: iso(r.created_at),
    };
  }

  /** Serialises the writes of one patient (cap, file reuse) on the consent row; no consent: 403. */
  private async lockConsent(tx: Tx, patientId: string): Promise<void> {
    const res = await tx.execute(sql`SELECT 1 FROM health_consents WHERE user_id = ${patientId}::uuid FOR UPDATE`);
    if (res.rows.length === 0) throw consentRequired();
  }

  private async assertRoom(tx: Tx, patientId: string): Promise<void> {
    const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM health_results WHERE user_id = ${patientId}::uuid`);
    if ((n.rows[0]?.n ?? 0) >= HEALTH_RESULTS_MAX) throw AppError.conflict('Too many results stored', { reason: 'limit_reached', limit: HEALTH_RESULTS_MAX });
  }

  /** The file must be a free ready upload of `owner`; it then belongs to the patient (deleted with the result). */
  private async attach(tx: Tx, owner: string, patientId: string, assetId: string): Promise<void> {
    await assertOwnReady(tx, owner, 'health_result', [assetId], 'assetId');
    const used = await tx.execute(sql`SELECT 1 FROM health_results WHERE media_id = ${assetId}::uuid LIMIT 1`);
    if (used.rows.length > 0) throw invalidAsset('assetId', 'file already attached elsewhere');
    if (owner !== patientId) await tx.execute(sql`UPDATE media_assets SET owner_user_id = ${patientId}::uuid WHERE id = ${assetId}::uuid`);
  }

  private async dropMedia(tx: Tx, mediaId: string | null | undefined): Promise<string[]> {
    if (!mediaId) return [];
    const gone = await tx.execute<{ storage_key: string }>(sql`DELETE FROM media_assets WHERE id = ${mediaId}::uuid RETURNING storage_key`);
    return gone.rows.map((r) => r.storage_key);
  }

  // ---- Patient ----------------------------------------------------------------------------------

  async list(userId: string, q: HealthResultListQuery): Promise<HealthResultList> {
    const consent = await this.db.execute(sql`SELECT 1 FROM health_consents WHERE user_id = ${userId}::uuid`);
    if (consent.rows.length === 0) throw consentRequired();
    const f = [sql`r.user_id = ${userId}::uuid`];
    if (q.kind) f.push(sql`r.kind = ${q.kind}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(r.result_date, r.id) < (${c.on}::date, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row>(sql`${SELECT} WHERE ${sql.join(f, sql` AND `)} ORDER BY r.result_date DESC, r.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.toResult(userId, r)), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.result_date, last.id) : null };
  }

  private async one(patientId: string, id: string): Promise<HealthResult> {
    if (!UUID_RE.test(id)) throw notFound('Result');
    const res = await this.db.execute<Row>(sql`${SELECT} WHERE r.id = ${id}::uuid AND r.user_id = ${patientId}::uuid`);
    if (!res.rows[0]) throw notFound('Result');
    return this.toResult(patientId, res.rows[0]);
  }

  async create(userId: string, body: CreateHealthResultRequest, meta: RequestMeta): Promise<HealthResult> {
    assertResultDate(body.resultDate);
    const payload = this.crypto.seal(userId, { title: body.title, summary: body.summary } satisfies Payload);
    const id = await this.db.transaction(async (tx) => {
      await this.lockConsent(tx, userId);
      await this.assertRoom(tx, userId);
      if (body.assetId) await this.attach(tx, userId, userId, body.assetId);
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO health_results (user_id, kind, payload, result_date, media_id) VALUES (${userId}::uuid, ${body.kind}, ${payload}, ${body.resultDate}::date, ${body.assetId}::uuid) RETURNING id`);
      const resultId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.result_created', actorUserId: userId, meta, metadata: { resultId, kind: body.kind, hasFile: body.assetId !== null } }, tx);
      return resultId;
    });
    return this.one(userId, id);
  }

  async update(userId: string, id: string, body: UpdateHealthResultRequest, meta: RequestMeta): Promise<HealthResult> {
    if (!UUID_RE.test(id)) throw notFound('Result');
    if (body.resultDate !== undefined) assertResultDate(body.resultDate);
    const removed = await this.db.transaction(async (tx) => {
      await this.lockConsent(tx, userId);
      const cur = (await tx.execute<{ kind: HealthResultKind; payload: string; result_date: string; media_id: string | null }>(sql`
        SELECT kind, payload, to_char(result_date, 'YYYY-MM-DD') AS result_date, media_id FROM health_results WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw notFound('Result');
      const p = this.crypto.open<Payload>(userId, cur.payload);
      const payload = this.crypto.seal(userId, { title: body.title ?? p.title, summary: body.summary ?? p.summary } satisfies Payload);
      const mediaId = body.assetId === undefined ? cur.media_id : body.assetId;
      const replaced = mediaId !== cur.media_id;
      if (replaced && mediaId) await this.attach(tx, userId, userId, mediaId);
      const kind = body.kind ?? cur.kind;
      await tx.execute(sql`
        UPDATE health_results SET kind = ${kind}, payload = ${payload}, result_date = ${body.resultDate ?? cur.result_date}::date, media_id = ${mediaId}::uuid, updated_at = now()
        WHERE id = ${id}::uuid`);
      const keys = replaced ? await this.dropMedia(tx, cur.media_id) : [];
      await this.audit.record({ action: 'health.result_updated', actorUserId: userId, meta, metadata: { resultId: id, kind, fileChanged: replaced } }, tx);
      return keys;
    });
    await deleteObjects(this.storage, removed);
    return this.one(userId, id);
  }

  async remove(userId: string, id: string, meta: RequestMeta): Promise<void> {
    const consent = await this.db.execute(sql`SELECT 1 FROM health_consents WHERE user_id = ${userId}::uuid`);
    if (consent.rows.length === 0) throw consentRequired();
    if (!UUID_RE.test(id)) return;
    const keys = await this.db.transaction(async (tx) => {
      const del = await tx.execute<{ kind: string; media_id: string | null }>(sql`DELETE FROM health_results WHERE id = ${id}::uuid AND user_id = ${userId}::uuid RETURNING kind, media_id`);
      const gone = del.rows[0];
      if (!gone) return [];
      await this.audit.record({ action: 'health.result_deleted', actorUserId: userId, meta, metadata: { resultId: id, kind: gone.kind } }, tx);
      return this.dropMedia(tx, gone.media_id);
    });
    await deleteObjects(this.storage, keys);
  }

  // ---- Professional -----------------------------------------------------------------------------

  /**
   * An approved professional adds a result for a patient they have a confirmed or completed appointment with (patient
   * consenting, not blocked). Anything else is a 404 so nothing leaks. The professional cannot read it back without a share.
   */
  async createFor(professionalId: string, patientId: string, body: CreateHealthResultRequest, meta: RequestMeta): Promise<{ id: string }> {
    if (!UUID_RE.test(patientId)) throw notFound('Patient');
    assertResultDate(body.resultDate);
    const payload = this.crypto.seal(patientId, { title: body.title, summary: body.summary } satisfies Payload);
    const id = await this.db.transaction(async (tx) => {
      const ok = await tx.execute(sql`
        SELECT 1 FROM health_consents c JOIN health_professionals p ON p.user_id = ${professionalId}::uuid AND p.status = 'approved'
        WHERE c.user_id = ${patientId}::uuid
          AND EXISTS (SELECT 1 FROM health_appointments a WHERE a.patient_id = c.user_id AND a.professional_id = p.user_id AND a.status IN ('confirmed', 'completed'))
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = c.user_id AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = c.user_id))
        FOR UPDATE OF c`);
      if (ok.rows.length === 0) throw notFound('Patient');
      await this.assertRoom(tx, patientId);
      // The daily cap spans several patients: serialise this professional's inserts.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`health-results:${professionalId}`}))`);
      const n = await tx.execute<{ per_patient: number; today: number }>(sql`
        SELECT count(*) FILTER (WHERE user_id = ${patientId}::uuid)::int AS per_patient, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today
        FROM health_results WHERE provider_user_id = ${professionalId}::uuid`);
      if ((n.rows[0]?.per_patient ?? 0) >= PRO_RESULTS_PER_PATIENT) throw AppError.conflict('Too many results added for this patient', { reason: 'limit_reached', limit: PRO_RESULTS_PER_PATIENT });
      if ((n.rows[0]?.today ?? 0) >= PRO_RESULTS_PER_DAY) throw AppError.conflict('Daily limit of added results reached', { reason: 'limit_reached', limit: PRO_RESULTS_PER_DAY });
      if (body.assetId) await this.attach(tx, professionalId, patientId, body.assetId);
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO health_results (user_id, kind, payload, result_date, provider_user_id, media_id)
        VALUES (${patientId}::uuid, ${body.kind}, ${payload}, ${body.resultDate}::date, ${professionalId}::uuid, ${body.assetId}::uuid) RETURNING id`);
      const resultId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.result_created', actorUserId: professionalId, subjectUserId: patientId, meta, metadata: { resultId, kind: body.kind, hasFile: body.assetId !== null } }, tx);
      return resultId;
    });
    await this.notifications.notify({ userId: patientId, category: 'system', title: 'CASELIND Santé', body: 'Un nouveau résultat est disponible.', data: { resultId: id } });
    return { id };
  }

  /** Needs an active share (not revoked or expired) covering `results`, an approved professional and a consenting patient: else 404. Logged for the patient. */
  async readShared(professionalId: string, patientId: string, meta: RequestMeta): Promise<SharedResults> {
    if (!UUID_RE.test(patientId)) throw notFound('Results');
    const share = await this.db.execute<{ id: string; expires_at: Date; display_name: string }>(sql`
      SELECT s.id, s.expires_at, u.display_name FROM health_shares s JOIN users u ON u.id = s.patient_id
      JOIN health_professionals p ON p.user_id = s.professional_id AND p.status = 'approved'
      JOIN health_consents c ON c.user_id = s.patient_id
      WHERE s.professional_id = ${professionalId}::uuid AND s.patient_id = ${patientId}::uuid AND s.revoked_at IS NULL AND s.expires_at > now() AND 'results' = ANY(s.kinds)
      ORDER BY s.created_at DESC LIMIT 1`);
    const s = share.rows[0];
    if (!s) throw notFound('Results');
    const res = await this.db.execute<Row>(sql`${SELECT} WHERE r.user_id = ${patientId}::uuid ORDER BY r.result_date DESC, r.id DESC LIMIT ${HEALTH_RESULTS_MAX}`);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO health_access_log (patient_id, accessor_id, share_id, entries_count) VALUES (${patientId}::uuid, ${professionalId}::uuid, ${s.id}::uuid, ${res.rows.length})`);
      await this.audit.record({ action: 'health.results_read', actorUserId: professionalId, subjectUserId: patientId, meta, metadata: { shareId: s.id, results: res.rows.length } }, tx);
    });
    return { patient: { id: patientId, displayName: s.display_name }, expiresAt: iso(s.expires_at), items: res.rows.map((r) => this.toResult(patientId, r)) };
  }

  // ---- Export and erasure -----------------------------------------------------------------------

  /** Decrypted copy for the personal data export. */
  async exportFor(userId: string): Promise<{ kind: HealthResultKind; resultDate: string; title: string; summary: string; provider: string | null; hasFile: boolean }[]> {
    const res = await this.db.execute<Row>(sql`${SELECT} WHERE r.user_id = ${userId}::uuid ORDER BY r.result_date, r.id`);
    return res.rows.map((r) => {
      const x = this.toResult(userId, r);
      return { kind: x.kind, resultDate: x.resultDate, title: x.title, summary: x.summary, provider: x.provider?.displayName ?? null, hasFile: x.file !== null };
    });
  }

  /** Deletes the user's results and their report files (rows now; the stored objects are deleted by the caller after commit with the returned keys). */
  async eraseFor(tx: Tx, userId: string): Promise<string[]> {
    const gone = await tx.execute<{ storage_key: string }>(sql`
      DELETE FROM media_assets WHERE id IN (SELECT media_id FROM health_results WHERE user_id = ${userId}::uuid AND media_id IS NOT NULL) RETURNING storage_key`);
    await tx.execute(sql`DELETE FROM health_results WHERE user_id = ${userId}::uuid`);
    return gone.rows.map((r) => r.storage_key);
  }

  deleteStored(keys: string[]): Promise<void> {
    return deleteObjects(this.storage, keys);
  }
}
