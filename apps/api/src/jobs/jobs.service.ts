import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  APPLICATION_TRANSITIONS,
  ErrorCodes,
  type ApplicationList,
  type MyJobProfile,
  type ApplicationStatus,
  type ApplyRequest,
  type CreateJobAlertRequest,
  type CreateJobRequest,
  type Interview,
  type InterviewList,
  type InterviewStatus,
  type ProposeInterviewRequest,
  type JobAlert,
  type JobAlertList,
  MAX_JOB_ALERTS,
  type Job,
  type JobList,
  type JobListQuery,
  type JobProfile,
  type JobProfileInput,
  type OrgApplicationList,
  type OrgApplicationsQuery,
  type OrgRole,
  type UpdateJobRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { assertOwnReady, deleteObjects, fileOf } from '../media/attachments.js';
import { MediaStorage } from '../media/storage.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { roleHasPermission } from '../orgs/org-permissions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => AppError.notFound('Job not found');
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);

type JobRow = {
  id: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  org_verified: boolean;
  title: string;
  description: string;
  city: string;
  contract_type: Job['contractType'];
  salary_min_minor: string | null;
  salary_max_minor: string | null;
  currency: string | null;
  status: 'open' | 'closed';
  created_at: Date;
  applied: boolean;
};

type AppRow = {
  id: string;
  status: ApplicationStatus;
  message: string;
  cv: JobProfile;
  cv_media_id: string | null;
  created_at: Date;
  updated_at: Date;
  job_id: string;
  job_title: string;
  org_name: string;
  user_id: string;
  display_name: string;
  handle: string;
};

/** Shown to everyone: open, not hidden by moderation, of an active public organisation. */
const publicSql: SQL = sql`j.status = 'open' AND NOT j.hidden AND o.status = 'active' AND o.visibility = 'public'`;

const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([new Date(at).toISOString(), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const iso = (d: Date) => new Date(d).toISOString();

const toJob = (r: JobRow): Job => ({
  id: r.id,
  org: { id: r.org_id, name: r.org_name, slug: r.org_slug, verified: r.org_verified },
  title: r.title,
  description: r.description,
  city: r.city,
  contractType: r.contract_type,
  salary: r.currency
    ? { minMinor: r.salary_min_minor === null ? null : Number(r.salary_min_minor), maxMinor: r.salary_max_minor === null ? null : Number(r.salary_max_minor), currency: r.currency.trim() }
    : null,
  status: r.status,
  createdAt: iso(r.created_at),
  applied: r.applied,
});

const STATUS_TEXT: Partial<Record<ApplicationStatus, string>> = {
  viewed: 'Votre candidature a été consultée.',
  shortlisted: 'Votre candidature a été retenue pour la suite.',
  interview: 'Vous êtes invité à un entretien.',
  offered: 'Une proposition vous a été faite.',
  hired: 'Félicitations, vous êtes recruté.',
  rejected: 'Votre candidature n’a pas été retenue.',
};

/** Jobs: offers published by organisations (permission `hr.manage`), a personal CV, applications with a controlled status flow. */
@Injectable()
export class JobsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationRegistry,
    private readonly storage: MediaStorage,
  ) {}

  onModuleInit(): void {
    this.moderation.register('job', {
      visibleTo: async (_viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`SELECT 1 FROM job_postings j JOIN organizations o ON o.id = j.org_id WHERE j.id = ${id}::uuid AND ${publicSql}`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const res = await this.db.execute<{ created_by: string }>(sql`SELECT created_by FROM job_postings WHERE id = ${id}::uuid`);
        return res.rows[0]?.created_by ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.execute(sql`UPDATE job_postings SET hidden = ${hidden} WHERE id = ${id}::uuid`);
      },
    });
  }

  // ---- Offers (organisation side) --------------------------------------------------------------

  async create(orgId: string, userId: string, body: CreateJobRequest, meta: RequestMeta): Promise<Job> {
    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO job_postings (org_id, created_by, title, description, city, contract_type, salary_min_minor, salary_max_minor, currency)
        VALUES (${orgId}::uuid, ${userId}::uuid, ${body.title}, ${body.description}, ${body.city}, ${body.contractType}, ${body.salaryMinMinor}, ${body.salaryMaxMinor}, ${body.currency})
        RETURNING id`);
      const jobId = res.rows[0]!.id;
      await this.audit.record({ action: 'job.posted', actorUserId: userId, meta, metadata: { orgId, jobId } }, tx);
      return jobId;
    });
    await this.notifyAlerts(orgId, id, body).catch(() => undefined); // best effort: the offer is already published
    return this.orgGet(orgId, id, userId);
  }

  async update(orgId: string, jobId: string, userId: string, body: UpdateJobRequest, meta: RequestMeta): Promise<Job> {
    const cur = await this.orgGet(orgId, jobId, userId);
    const min = body.salaryMinMinor !== undefined ? body.salaryMinMinor : (cur.salary?.minMinor ?? null);
    const max = body.salaryMaxMinor !== undefined ? body.salaryMaxMinor : (cur.salary?.maxMinor ?? null);
    const currency = body.currency !== undefined ? body.currency : (cur.salary?.currency ?? null);
    if ((min !== null || max !== null) !== (currency !== null)) throw invalid('currency', 'a salary needs a currency, and a currency needs a salary');
    if (min !== null && max !== null && min > max) throw invalid('salaryMaxMinor', 'salaryMaxMinor must be at least salaryMinMinor');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE job_postings SET title = ${body.title ?? cur.title}, description = ${body.description ?? cur.description}, city = ${body.city ?? cur.city},
          contract_type = ${body.contractType ?? cur.contractType}, salary_min_minor = ${min}, salary_max_minor = ${max}, currency = ${currency}, updated_at = now()
        WHERE id = ${jobId}::uuid`);
      await this.audit.record({ action: 'job.updated', actorUserId: userId, meta, metadata: { orgId, jobId } }, tx);
    });
    return this.orgGet(orgId, jobId, userId);
  }

  /** Closing keeps the applications. Idempotent. */
  async close(orgId: string, jobId: string, userId: string, meta: RequestMeta): Promise<Job> {
    const cur = await this.orgGet(orgId, jobId, userId);
    if (cur.status === 'open') {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE job_postings SET status = 'closed', updated_at = now() WHERE id = ${jobId}::uuid`);
        await this.audit.record({ action: 'job.closed', actorUserId: userId, meta, metadata: { orgId, jobId } }, tx);
      });
    }
    return this.orgGet(orgId, jobId, userId);
  }

  async orgList(orgId: string, userId: string, q: { limit: number; cursor?: string }): Promise<JobList> {
    const f: SQL[] = [sql`j.org_id = ${orgId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(j.created_at, j.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(userId, f, q.limit);
  }

  private async orgGet(orgId: string, jobId: string, userId: string): Promise<Job> {
    if (!UUID_RE.test(jobId)) throw notFound();
    const res = await this.db.execute<JobRow>(sql`${this.base(userId)} WHERE j.id = ${jobId}::uuid AND j.org_id = ${orgId}::uuid`);
    if (!res.rows[0]) throw notFound();
    return toJob(res.rows[0]);
  }

  // ---- Offers (public side) ---------------------------------------------------------------------

  async get(viewerId: string, jobId: string): Promise<Job> {
    if (!UUID_RE.test(jobId)) throw notFound();
    const res = await this.db.execute<JobRow>(sql`${this.base(viewerId)} WHERE j.id = ${jobId}::uuid AND ${publicSql}`);
    if (!res.rows[0]) throw notFound();
    return toJob(res.rows[0]);
  }

  async list(viewerId: string, q: JobListQuery): Promise<JobList> {
    const f: SQL[] = [publicSql];
    if (q.contractType) f.push(sql`j.contract_type = ${q.contractType}`);
    if (q.city) f.push(sql`j.city ILIKE ${escapeLike(q.city)}`);
    if (q.q) f.push(sql`(j.title ILIKE ${'%' + escapeLike(q.q) + '%'} OR j.description ILIKE ${'%' + escapeLike(q.q) + '%'} OR o.name ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(j.created_at, j.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(viewerId, f, q.limit);
  }

  private async page(viewerId: string, filters: SQL[], limit: number): Promise<JobList> {
    const res = await this.db.execute<JobRow>(sql`${this.base(viewerId)} WHERE ${sql.join(filters, sql` AND `)} ORDER BY j.created_at DESC, j.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return { items: rows.map(toJob), nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  private base(viewerId: string): SQL {
    return sql`
      SELECT j.id, j.org_id, o.name AS org_name, o.slug::text AS org_slug, (o.verification_status = 'verified') AS org_verified,
        j.title, j.description, j.city, j.contract_type, j.salary_min_minor, j.salary_max_minor, j.currency, j.status, j.created_at,
        EXISTS (SELECT 1 FROM job_applications a WHERE a.posting_id = j.id AND a.user_id = ${viewerId}::uuid) AS applied
      FROM job_postings j JOIN organizations o ON o.id = j.org_id`;
  }

  // ---- Alerts (private to their owner) ----------------------------------------------------------

  private toAlert = (r: { id: string; q: string | null; city: string | null; contract_type: JobAlert['contractType']; created_at: Date }): JobAlert => ({
    id: r.id,
    q: r.q,
    city: r.city,
    contractType: r.contract_type,
    createdAt: iso(r.created_at),
  });

  async listAlerts(userId: string): Promise<JobAlertList> {
    const res = await this.db.execute<{ id: string; q: string | null; city: string | null; contract_type: JobAlert['contractType']; created_at: Date }>(
      sql`SELECT id, q, city, contract_type, created_at FROM job_alerts WHERE user_id = ${userId}::uuid ORDER BY created_at, id`,
    );
    return { items: res.rows.map(this.toAlert) };
  }

  async createAlert(userId: string, body: CreateJobAlertRequest, meta: RequestMeta): Promise<JobAlert> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`); // serialises the quota check
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM job_alerts WHERE user_id = ${userId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= MAX_JOB_ALERTS) throw AppError.conflict('Job alert limit reached', { reason: 'alert_limit' });
      const res = await tx.execute<{ id: string; q: string | null; city: string | null; contract_type: JobAlert['contractType']; created_at: Date }>(sql`
        INSERT INTO job_alerts (user_id, q, city, contract_type) VALUES (${userId}::uuid, ${body.q ?? null}, ${body.city ?? null}, ${body.contractType ?? null})
        RETURNING id, q, city, contract_type, created_at`);
      const row = res.rows[0]!;
      await this.audit.record({ action: 'job.alert_created', actorUserId: userId, meta, metadata: { alertId: row.id } }, tx);
      return this.toAlert(row);
    });
  }

  /** Idempotent; only the owner can delete (anything else is a no-op 204). */
  async deleteAlert(userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`DELETE FROM job_alerts WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
      if (res.rowCount) await this.audit.record({ action: 'job.alert_deleted', actorUserId: userId, meta, metadata: { alertId: id } }, tx);
    });
  }

  /** Same filter as GET /jobs (text in title, description or organisation name; city; contract). Generic title: never the offer's content. */
  private async notifyAlerts(orgId: string, jobId: string, body: CreateJobRequest): Promise<void> {
    const org = await this.db.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}::uuid AND status = 'active' AND visibility = 'public'`);
    if (org.rows.length === 0) return;
    const res = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT a.user_id FROM job_alerts a, organizations o
      WHERE o.id = ${orgId}::uuid
        AND (a.contract_type IS NULL OR a.contract_type = ${body.contractType})
        AND (a.city IS NULL OR lower(a.city) = lower(${body.city}))
        AND (a.q IS NULL OR position(lower(a.q) in lower(${body.title} || ' ' || ${body.description} || ' ' || o.name)) > 0)
        AND NOT EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = o.id AND m.user_id = a.user_id AND m.status = 'active')
        AND a.user_id <> (SELECT created_by FROM job_postings WHERE id = ${jobId}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = a.user_id AND (b.blocked_id = (SELECT created_by FROM job_postings WHERE id = ${jobId}::uuid)
                  OR b.blocked_id IN (SELECT user_id FROM org_members WHERE org_id = o.id AND status = 'active')))
             OR (b.blocked_id = a.user_id AND (b.blocker_id = (SELECT created_by FROM job_postings WHERE id = ${jobId}::uuid)
                  OR b.blocker_id IN (SELECT user_id FROM org_members WHERE org_id = o.id AND status = 'active'))))
        LIMIT 500`); // shortcut: 500 recipients per offer, no paging; upgrade to a batched job if alerts exceed that
    await this.notifications.notifyMany(res.rows.map((r) => ({ userId: r.user_id, category: 'job' as const, title: 'Nouvelle offre correspondant à votre alerte', body: 'Ouvrez l’emploi pour la consulter.', data: { jobId } })));
  }

  // ---- CV ---------------------------------------------------------------------------------------

  async getProfile(userId: string): Promise<JobProfile | null> {
    const res = await this.db.execute<JobProfile>(sql`SELECT headline, summary, skills, city, experience, education FROM job_profiles WHERE user_id = ${userId}::uuid`);
    return res.rows[0] ?? null;
  }

  async myProfile(userId: string): Promise<MyJobProfile> {
    const cv = await this.db.execute<{ cv_media_id: string | null }>(sql`SELECT cv_media_id FROM job_profiles WHERE user_id = ${userId}::uuid`);
    return { profile: await this.getProfile(userId), cvFile: await fileOf(this.db, cv.rows[0]?.cv_media_id ?? null) };
  }

  /** Deletes a CV file unless an application still carries it (the recruiter keeps the snapshot). Returns the storage keys to remove. */
  private async dropCvFile(tx: Pick<Db, 'execute'>, mediaId: string | null): Promise<string[]> {
    if (!mediaId) return [];
    const res = await tx.execute<{ storage_key: string }>(sql`
      DELETE FROM media_assets WHERE id = ${mediaId}::uuid AND NOT EXISTS (SELECT 1 FROM job_applications WHERE cv_media_id = ${mediaId}::uuid) RETURNING storage_key`);
    return res.rows.map((r) => r.storage_key);
  }

  /** Attaches (or removes with null) the PDF of the CV. The previous file is deleted unless an application carries it. */
  async setCvFile(userId: string, assetId: string | null, meta: RequestMeta): Promise<MyJobProfile> {
    const keys = await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ cv_media_id: string | null }>(sql`SELECT cv_media_id FROM job_profiles WHERE user_id = ${userId}::uuid FOR UPDATE`);
      if (!cur.rows[0]) throw AppError.conflict('Create your CV first', { reason: 'profile_required' });
      const old = cur.rows[0].cv_media_id;
      if (assetId) await assertOwnReady(tx, userId, 'cv', [assetId], 'assetId');
      await tx.execute(sql`UPDATE job_profiles SET cv_media_id = ${assetId}::uuid, updated_at = now() WHERE user_id = ${userId}::uuid`);
      await this.audit.record({ action: assetId ? 'job.cv_file_set' : 'job.cv_file_removed', actorUserId: userId, meta, metadata: {} }, tx);
      return old && old !== assetId ? this.dropCvFile(tx, old) : [];
    });
    await deleteObjects(this.storage, keys);
    return this.myProfile(userId);
  }

  async saveProfile(userId: string, body: JobProfileInput, meta: RequestMeta): Promise<JobProfile> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO job_profiles (user_id, headline, summary, skills, city, experience, education)
        VALUES (${userId}::uuid, ${body.headline}, ${body.summary}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.skills)}::jsonb)), ${body.city}, ${body.experience}, ${body.education})
        ON CONFLICT (user_id) DO UPDATE SET headline = EXCLUDED.headline, summary = EXCLUDED.summary, skills = EXCLUDED.skills, city = EXCLUDED.city,
          experience = EXCLUDED.experience, education = EXCLUDED.education, updated_at = now()`);
      await this.audit.record({ action: 'job.profile_saved', actorUserId: userId, meta, metadata: {} }, tx);
    });
    return (await this.getProfile(userId))!;
  }

  async deleteProfile(userId: string, meta: RequestMeta): Promise<void> {
    const keys = await this.db.transaction(async (tx) => {
      const del = await tx.execute<{ cv_media_id: string | null }>(sql`DELETE FROM job_profiles WHERE user_id = ${userId}::uuid RETURNING cv_media_id`);
      if (del.rows.length === 0) return [];
      await this.audit.record({ action: 'job.profile_deleted', actorUserId: userId, meta, metadata: {} }, tx);
      return this.dropCvFile(tx, del.rows[0]!.cv_media_id);
    });
    await deleteObjects(this.storage, keys);
  }

  // ---- Applications (candidate side) ------------------------------------------------------------

  async apply(userId: string, jobId: string, body: ApplyRequest, meta: RequestMeta): Promise<ApplicationList['items'][number]> {
    if (!UUID_RE.test(jobId)) throw notFound();
    const job = await this.db.execute<{ org_id: string; title: string }>(sql`
      SELECT j.org_id, j.title FROM job_postings j JOIN organizations o ON o.id = j.org_id WHERE j.id = ${jobId}::uuid AND ${publicSql}`);
    const row = job.rows[0];
    if (!row) throw notFound();
    const member = await this.db.execute(sql`SELECT 1 FROM org_members WHERE org_id = ${row.org_id}::uuid AND user_id = ${userId}::uuid AND status = 'active'`);
    if (member.rows.length > 0) throw AppError.forbidden('You cannot apply to an offer of your own organisation');
    const cv = await this.getProfile(userId);
    if (!cv) throw AppError.conflict('Create your CV before applying', { reason: 'profile_required' });
    const id = await this.db.transaction(async (tx) => {
      const dup = await tx.execute(sql`SELECT 1 FROM job_applications WHERE posting_id = ${jobId}::uuid AND user_id = ${userId}::uuid`);
      if (dup.rows.length > 0) throw AppError.conflict('You already applied', { reason: 'already_applied' });
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO job_applications (posting_id, user_id, message, cv, cv_media_id)
        SELECT ${jobId}::uuid, ${userId}::uuid, ${body.message}, ${JSON.stringify(cv)}::jsonb, (SELECT cv_media_id FROM job_profiles WHERE user_id = ${userId}::uuid) RETURNING id`);
      const appId = ins.rows[0]!.id;
      await this.audit.record({ action: 'job.applied', actorUserId: userId, meta, metadata: { orgId: row.org_id, jobId, applicationId: appId } }, tx);
      return appId;
    });
    await this.notifyRecruiters(row.org_id, jobId, row.title, userId);
    return (await this.myApplication(userId, id))!;
  }

  async myApplications(userId: string, q: { limit: number; cursor?: string }): Promise<ApplicationList> {
    const f: SQL[] = [sql`a.user_id = ${userId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(a.created_at, a.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const page = await this.appPage(f, q.limit);
    return { items: page.items.map(({ applicant: _a, cv: _c, ...app }) => app), nextCursor: page.nextCursor };
  }

  private async myApplication(userId: string, id: string) {
    const page = await this.appPage([sql`a.id = ${id}::uuid`, sql`a.user_id = ${userId}::uuid`], 1);
    const first = page.items[0];
    if (!first) return undefined;
    const { applicant: _a, cv: _c, ...app } = first;
    return app;
  }

  /** Candidate withdraws a live application. Idempotent once withdrawn; a decided one stays as it is (409). */
  async withdraw(userId: string, applicationId: string, meta: RequestMeta): Promise<ApplicationList['items'][number]> {
    if (!UUID_RE.test(applicationId)) throw AppError.notFound('Application not found');
    await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ status: ApplicationStatus; posting_id: string }>(sql`
        SELECT status, posting_id FROM job_applications WHERE id = ${applicationId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`);
      const cur = res.rows[0];
      if (!cur) throw AppError.notFound('Application not found');
      if (cur.status === 'withdrawn') return;
      if (APPLICATION_TRANSITIONS[cur.status].length === 0) throw AppError.conflict('This application is already decided', { reason: 'application_final' });
      await tx.execute(sql`UPDATE job_applications SET status = 'withdrawn', updated_at = now() WHERE id = ${applicationId}::uuid`);
      await this.audit.record({ action: 'job.application_withdrawn', actorUserId: userId, meta, metadata: { applicationId } }, tx);
    });
    return (await this.myApplication(userId, applicationId))!;
  }

  // ---- Applications (recruiter side) ------------------------------------------------------------

  async orgApplications(orgId: string, jobId: string, q: OrgApplicationsQuery): Promise<OrgApplicationList> {
    if (!UUID_RE.test(jobId)) throw notFound();
    const f: SQL[] = [sql`j.id = ${jobId}::uuid`, sql`j.org_id = ${orgId}::uuid`];
    if (q.status) f.push(sql`a.status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(a.created_at, a.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.appPage(f, q.limit);
  }

  async setStatus(orgId: string, applicationId: string, userId: string, status: ApplicationStatus, meta: RequestMeta): Promise<OrgApplicationList['items'][number]> {
    if (!UUID_RE.test(applicationId)) throw AppError.notFound('Application not found');
    const target = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ status: ApplicationStatus; user_id: string; title: string; posting_id: string }>(sql`
        SELECT a.status, a.user_id, j.title, j.id AS posting_id FROM job_applications a JOIN job_postings j ON j.id = a.posting_id
        WHERE a.id = ${applicationId}::uuid AND j.org_id = ${orgId}::uuid FOR UPDATE OF a`);
      const cur = res.rows[0];
      if (!cur) throw AppError.notFound('Application not found');
      if (!APPLICATION_TRANSITIONS[cur.status].includes(status)) {
        throw AppError.conflict(`An application ${cur.status} cannot become ${status}`, { reason: 'invalid_transition', from: cur.status, to: status });
      }
      await tx.execute(sql`UPDATE job_applications SET status = ${status}, updated_at = now() WHERE id = ${applicationId}::uuid`);
      await this.audit.record({ action: 'job.application_status', actorUserId: userId, meta, metadata: { orgId, applicationId, from: cur.status, to: status } }, tx);
      return cur;
    });
    const text = STATUS_TEXT[status];
    if (text) {
      await this.notifications.notify({ userId: target.user_id, category: 'job', title: target.title, body: text, data: { applicationId, jobId: target.posting_id } });
    }
    const out = await this.appPage([sql`a.id = ${applicationId}::uuid`], 1);
    return out.items[0]!;
  }

  private async appPage(filters: SQL[], limit: number): Promise<OrgApplicationList> {
    const res = await this.db.execute<AppRow>(sql`
      SELECT a.id, a.status, a.message, a.cv, a.cv_media_id, a.created_at, a.updated_at, j.id AS job_id, j.title AS job_title, o.name AS org_name,
        u.id AS user_id, u.display_name, u.handle::text AS handle
      FROM job_applications a JOIN job_postings j ON j.id = a.posting_id JOIN organizations o ON o.id = j.org_id JOIN users u ON u.id = a.user_id
      WHERE ${sql.join(filters, sql` AND `)} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    const cvFiles = await Promise.all(rows.map((r) => fileOf(this.db, r.cv_media_id)));
    return {
      items: rows.map((r, i) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        job: { id: r.job_id, title: r.job_title, orgName: r.org_name },
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
        applicant: { id: r.user_id, displayName: r.display_name, handle: r.handle },
        cv: r.cv,
        cvFile: cvFiles[i] ?? null,
      })),
      nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  // ---- Interview calendar (lot 16f): no video link; notifications and audit never carry the place or the reason ----

  private async interviewPage(filters: SQL[]): Promise<InterviewList> {
    const res = await this.db.execute<{
      id: string; application_id: string; status: InterviewStatus; starts_at: Date; duration_min: number; location: string; reason: string; created_at: Date; updated_at: Date;
      job_id: string; job_title: string; org_name: string; user_id: string; display_name: string; handle: string;
    }>(sql`
      SELECT i.id, i.application_id, i.status, i.starts_at, i.duration_min, i.location, i.reason, i.created_at, i.updated_at,
        j.id AS job_id, j.title AS job_title, o.name AS org_name, u.id AS user_id, u.display_name, u.handle::text AS handle
      FROM job_interviews i JOIN job_applications a ON a.id = i.application_id JOIN job_postings j ON j.id = a.posting_id
      JOIN organizations o ON o.id = j.org_id JOIN users u ON u.id = a.user_id
      WHERE ${sql.join(filters, sql` AND `)} ORDER BY i.starts_at DESC, i.id DESC LIMIT 100`); // shortcut: no cursor, 100 newest, when someone has more
    return {
      items: res.rows.map((r) => ({
        id: r.id,
        applicationId: r.application_id,
        status: r.status,
        startsAt: iso(r.starts_at),
        durationMin: r.duration_min,
        location: r.location,
        reason: r.reason,
        job: { id: r.job_id, title: r.job_title, orgName: r.org_name },
        applicant: { id: r.user_id, displayName: r.display_name, handle: r.handle },
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      })),
    };
  }

  myInterviews(userId: string): Promise<InterviewList> {
    return this.interviewPage([sql`a.user_id = ${userId}::uuid`]);
  }

  async orgInterviews(orgId: string, applicationId: string): Promise<InterviewList> {
    if (!UUID_RE.test(applicationId)) throw AppError.notFound('Application not found');
    return this.interviewPage([sql`a.id = ${applicationId}::uuid`, sql`j.org_id = ${orgId}::uuid`]);
  }

  async proposeInterview(orgId: string, applicationId: string, userId: string, body: ProposeInterviewRequest, meta: RequestMeta): Promise<Interview> {
    if (!UUID_RE.test(applicationId)) throw AppError.notFound('Application not found');
    if (new Date(body.startsAt).getTime() <= Date.now()) throw invalid('startsAt', 'must be in the future');
    const { id, candidateId } = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ status: ApplicationStatus; user_id: string }>(sql`
        SELECT a.status, a.user_id FROM job_applications a JOIN job_postings j ON j.id = a.posting_id
        WHERE a.id = ${applicationId}::uuid AND j.org_id = ${orgId}::uuid FOR UPDATE OF a`);
      const app = res.rows[0];
      if (!app) throw AppError.notFound('Application not found');
      if (APPLICATION_TRANSITIONS[app.status].length === 0) throw AppError.conflict('This application is already decided', { reason: 'application_final' });
      const live = await tx.execute(sql`SELECT 1 FROM job_interviews WHERE application_id = ${applicationId}::uuid AND status IN ('proposed', 'confirmed')`);
      if (live.rows.length) throw AppError.conflict('An interview is already pending or confirmed', { reason: 'interview_exists' });
      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO job_interviews (application_id, proposed_by, starts_at, duration_min, location)
        VALUES (${applicationId}::uuid, ${userId}::uuid, ${body.startsAt}::timestamptz, ${body.durationMin}, ${body.location}) RETURNING id`);
      const row = ins.rows[0]!;
      await this.audit.record({ action: 'job.interview_proposed', actorUserId: userId, meta, metadata: { orgId, applicationId, interviewId: row.id } }, tx);
      return { id: row.id, candidateId: app.user_id };
    });
    await this.notifications.notify({ userId: candidateId, category: 'job', title: 'Entretien proposé', body: 'Ouvrez « Mes entretiens » pour répondre.', data: { interviewId: id } }).catch(() => undefined);
    return (await this.interviewPage([sql`i.id = ${id}::uuid`])).items[0]!;
  }

  /** One state change. `org`: the recruiter cancels; `candidate`: confirm, decline or cancel (confirmed only, 1 h before at the latest). */
  async changeInterview(
    who: { side: 'org'; orgId: string } | { side: 'candidate'; userId: string },
    actorId: string,
    interviewId: string,
    action: 'confirm' | 'decline' | 'cancel',
    reason: string,
    meta: RequestMeta,
  ): Promise<Interview> {
    if (!UUID_RE.test(interviewId)) throw AppError.notFound('Interview not found');
    const party = who.side === 'org' ? sql`j.org_id = ${who.orgId}::uuid` : sql`a.user_id = ${who.userId}::uuid`;
    const info = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ status: InterviewStatus; starts_at: Date; user_id: string; org_id: string; posting_id: string }>(sql`
        SELECT i.status, i.starts_at, a.user_id, j.org_id, j.id AS posting_id FROM job_interviews i
        JOIN job_applications a ON a.id = i.application_id JOIN job_postings j ON j.id = a.posting_id
        WHERE i.id = ${interviewId}::uuid AND ${party} FOR UPDATE OF i`);
      const cur = res.rows[0];
      if (!cur) throw AppError.notFound('Interview not found');
      const at = new Date(cur.starts_at).getTime();
      const ok = action === 'cancel' ? (who.side === 'org' ? cur.status === 'proposed' || cur.status === 'confirmed' : cur.status === 'confirmed') : cur.status === 'proposed';
      if (!ok) throw AppError.conflict(`An interview ${cur.status} cannot be ${action}ed`, { reason: 'invalid_state', status: cur.status });
      const past = at <= Date.now();
      // A stale proposed/confirmed interview can still be declined or cancelled (the unique index would otherwise block a new one).
      if (past && action === 'confirm') throw AppError.conflict('This interview already took place', { reason: 'interview_past' });
      if (action === 'cancel' && who.side === 'candidate' && !past && at - Date.now() < 3_600_000) throw AppError.conflict('Too late to cancel (less than 1 hour)', { reason: 'too_late' });
      const status = action === 'confirm' ? 'confirmed' : action === 'decline' ? 'declined' : 'cancelled';
      await tx.execute(sql`UPDATE job_interviews SET status = ${status}, reason = ${action === 'decline' ? reason : ''}, updated_at = now() WHERE id = ${interviewId}::uuid`);
      await this.audit.record({ action: `job.interview_${status}` as 'job.interview_confirmed', actorUserId: actorId, meta, metadata: { orgId: cur.org_id, interviewId } }, tx);
      return cur;
    });
    const label = action === 'confirm' ? 'confirmé' : action === 'decline' ? 'refusé' : 'annulé';
    const title = `Entretien ${label}`;
    const data = { interviewId, jobId: info.posting_id };
    if (who.side === 'org') {
      await this.notifications.notify({ userId: info.user_id, category: 'job', title, body: 'Ouvrez « Mes entretiens ».', data }).catch(() => undefined);
    } else {
      const m = await this.db.execute<{ user_id: string; role: OrgRole }>(sql`SELECT user_id, role FROM org_members WHERE org_id = ${info.org_id}::uuid AND status = 'active'`);
      const to = m.rows.filter((r) => roleHasPermission(r.role, 'hr.manage') && r.user_id !== actorId);
      await this.notifications.notifyMany(to.map((r) => ({ userId: r.user_id, category: 'job' as const, title, body: 'Consultez la candidature.', data }))).catch(() => undefined);
    }
    return (await this.interviewPage([sql`i.id = ${interviewId}::uuid`])).items[0]!;
  }

  private async notifyRecruiters(orgId: string, jobId: string, title: string, applicantId: string): Promise<void> {
    const res = await this.db.execute<{ user_id: string; role: OrgRole }>(sql`SELECT user_id, role FROM org_members WHERE org_id = ${orgId}::uuid AND status = 'active'`);
    const recipients = res.rows.filter((m) => roleHasPermission(m.role, 'hr.manage') && m.user_id !== applicantId);
    await this.notifications.notifyMany(recipients.map((m) => ({ userId: m.user_id, category: 'job' as const, title, body: 'Nouvelle candidature reçue.', data: { jobId } })));
  }
}
