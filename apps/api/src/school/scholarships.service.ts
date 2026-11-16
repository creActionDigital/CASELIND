import { Inject, Injectable } from '@nestjs/common';
import { type CreateScholarshipRequest, ErrorCodes, type Scholarship, type ScholarshipList, type ScholarshipListQuery, type SchoolSearchQuery, type SchoolSummaryList } from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([new Date(at).toISOString(), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'cursor', message: 'invalid cursor' }]);
}

type Row = { id: string; slug: string; name: string; city: string | null; logo_url: string | null; verified: boolean; created_at: Date };
type SRow = {
  id: string;
  org_id: string;
  title: string;
  description: string;
  deadline: string | null;
  url: string | null;
  status: 'open' | 'closed';
  created_at: Date;
  org_slug: string;
  org_name: string;
  org_city: string | null;
  org_verified: boolean;
};

const toScholarship = (r: SRow): Scholarship => ({
  id: r.id,
  school: { id: r.org_id, slug: r.org_slug, name: r.org_name, city: r.org_city, verified: r.org_verified },
  title: r.title,
  description: r.description,
  deadline: r.deadline,
  url: r.url,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Public and active schools: same rule as the storefront. */
const publicSchool: SQL = sql`o.kind = 'school' AND o.status = 'active' AND o.visibility = 'public'`;
const SELECT_S = sql`SELECT s.id, s.org_id, s.title, s.description, to_char(s.deadline, 'YYYY-MM-DD') AS deadline, s.url, s.status, s.created_at,
  o.slug::text AS org_slug, o.name AS org_name, o.city AS org_city, (o.verification_status = 'verified') AS org_verified
  FROM school_scholarships s JOIN organizations o ON o.id = s.org_id`;

/** School search and scholarships. Audit holds ids only, never the text. */
@Injectable()
export class ScholarshipsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async searchSchools(q: SchoolSearchQuery): Promise<SchoolSummaryList> {
    const f: SQL[] = [publicSchool];
    if (q.q) f.push(sql`o.name ILIKE ${'%' + escapeLike(q.q) + '%'}`);
    if (q.city) f.push(sql`o.city ILIKE ${escapeLike(q.city)}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(o.created_at, o.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row>(sql`
      SELECT o.id, o.slug::text AS slug, o.name, o.city, o.logo_url, (o.verification_status = 'verified') AS verified, o.created_at
      FROM organizations o WHERE ${sql.join(f, sql` AND `)} ORDER BY o.created_at DESC, o.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, city: r.city, logoUrl: r.logo_url, verified: r.verified })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  private async page(filters: SQL[], limit: number): Promise<ScholarshipList> {
    const res = await this.db.execute<SRow>(sql`${SELECT_S} WHERE ${sql.join(filters, sql` AND `)} ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit + 1}`);
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return { items: rows.map(toScholarship), nextCursor: res.rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  /** Open (not closed, deadline not passed) scholarships of public active schools. */
  list(q: ScholarshipListQuery): Promise<ScholarshipList> {
    const f: SQL[] = [publicSchool, sql`s.status = 'open' AND (s.deadline IS NULL OR s.deadline >= current_date)`];
    if (q.city) f.push(sql`o.city ILIKE ${escapeLike(q.city)}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(s.created_at, s.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(f, q.limit);
  }

  async get(id: string): Promise<Scholarship> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Scholarship not found');
    const res = await this.db.execute<SRow>(sql`${SELECT_S} WHERE s.id = ${id}::uuid AND ${publicSchool}`);
    if (!res.rows[0]) throw AppError.notFound('Scholarship not found');
    return toScholarship(res.rows[0]);
  }

  // ---- Staff (org.members.manage) ---------------------------------------------------------------

  orgList(orgId: string, q: ScholarshipListQuery): Promise<ScholarshipList> {
    const f: SQL[] = [sql`s.org_id = ${orgId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(s.created_at, s.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    return this.page(f, q.limit);
  }

  async publish(orgId: string, userId: string, b: CreateScholarshipRequest, meta: RequestMeta): Promise<Scholarship> {
    const k = await this.db.execute<{ kind: string }>(sql`SELECT kind FROM organizations WHERE id = ${orgId}::uuid`);
    if (k.rows[0]?.kind !== 'school') throw AppError.conflict('Only a school can publish scholarships', { reason: 'not_a_school' });
    const r = await this.db.execute<{ id: string }>(sql`
      INSERT INTO school_scholarships (org_id, title, description, deadline, url)
      VALUES (${orgId}::uuid, ${b.title}, ${b.description}, ${b.deadline ?? null}::date, ${b.url ?? null}) RETURNING id`);
    const id = r.rows[0]!.id;
    await this.audit.record({ action: 'school.scholarship_published', actorUserId: userId, meta, metadata: { orgId, scholarshipId: id } });
    const res = await this.db.execute<SRow>(sql`${SELECT_S} WHERE s.id = ${id}::uuid`);
    return toScholarship(res.rows[0]!);
  }

  async close(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Scholarship not found');
    const r = await this.db.execute(sql`UPDATE school_scholarships SET status = 'closed' WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING id`);
    if (r.rows.length === 0) throw AppError.notFound('Scholarship not found');
    await this.audit.record({ action: 'school.scholarship_closed', actorUserId: userId, meta, metadata: { orgId, scholarshipId: id } });
  }
}
