import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  type CreateHelpRequestRequest,
  createHelpRequestRequestSchema,
  type ResolveHelpRequestRequest,
  resolveHelpRequestRequestSchema,
  type HelpRequest,
  type HelpRequestList,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB, type Db } from '../db/db.module.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';

const OPEN_MAX = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = { id: string; user_id: string; category: HelpRequest['category']; subject: string; body: string; status: 'open' | 'resolved'; reply: string | null; created_at: string; resolved_at: string | null };
const COLS = sql.raw('id, user_id, category, subject, body, status, reply, created_at::text AS created_at, resolved_at::text AS resolved_at');
const iso = (v: string) => new Date(v).toISOString();
const toTicket = (r: Row, admin = false): HelpRequest => ({
  id: r.id, category: r.category, subject: r.subject, body: r.body, status: r.status, reply: r.reply,
  createdAt: iso(r.created_at), resolvedAt: r.resolved_at ? iso(r.resolved_at) : null, ...(admin ? { userId: r.user_id } : {}),
});

/** Support CASELIND : demandes d'aide de l'utilisateur, traitees par les administrateurs. */
@Injectable()
export class HelpService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  async create(userId: string, b: CreateHelpRequestRequest): Promise<HelpRequest> {
    const open = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM help_requests WHERE user_id = ${userId}::uuid AND status = 'open'`);
    if ((open.rows[0]?.n ?? 0) >= OPEN_MAX) throw AppError.conflict('Too many open requests', { reason: 'too_many_open' });
    const res = await this.db.execute<Row>(sql`INSERT INTO help_requests (user_id, category, subject, body) VALUES (${userId}::uuid, ${b.category}, ${b.subject}, ${b.body}) RETURNING ${COLS}`);
    return toTicket(res.rows[0]!);
  }

  async mine(userId: string): Promise<HelpRequestList> {
    const res = await this.db.execute<Row>(sql`SELECT ${COLS} FROM help_requests WHERE user_id = ${userId}::uuid ORDER BY created_at DESC, id DESC LIMIT 50`);
    return { items: res.rows.map((r) => toTicket(r)) };
  }

  async adminList(status: string | undefined): Promise<HelpRequestList> {
    const st = status === 'resolved' ? 'resolved' : 'open';
    const res = await this.db.execute<Row>(sql`SELECT ${COLS} FROM help_requests WHERE status = ${st} ORDER BY created_at ASC, id ASC LIMIT 100`);
    return { items: res.rows.map((r) => toTicket(r, true)) };
  }

  async resolve(adminId: string, id: string, b: ResolveHelpRequestRequest, meta: RequestMeta): Promise<HelpRequest> {
    if (!UUID.test(id)) throw AppError.notFound('Request not found');
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<Row>(sql`UPDATE help_requests SET status = 'resolved', reply = ${b.reply}, resolved_by = ${adminId}::uuid, resolved_at = now() WHERE id = ${id}::uuid AND status = 'open' RETURNING ${COLS}`);
      const r = res.rows[0];
      if (!r) throw AppError.notFound('Request not found');
      await this.audit.record({ action: 'help.request_resolved', actorUserId: adminId, meta, metadata: { requestId: id } }, tx);
      return toTicket(r, true);
    });
  }
}

@Controller('me/help-requests')
export class HelpMeController {
  constructor(private readonly support: HelpService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createHelpRequestRequestSchema)) b: CreateHelpRequestRequest): Promise<HelpRequest> {
    return this.support.create(u.userId, b);
  }

  @Get()
  mine(@CurrentUser() u: AuthUser): Promise<HelpRequestList> {
    return this.support.mine(u.userId);
  }
}

@Controller('admin/help-requests')
@Roles('admin')
export class HelpAdminController {
  constructor(private readonly support: HelpService) {}

  @Get()
  list(@Query('status') status?: string): Promise<HelpRequestList> {
    return this.support.adminList(status);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resolveHelpRequestRequestSchema)) b: ResolveHelpRequestRequest, @ReqMeta() meta: RequestMeta): Promise<HelpRequest> {
    return this.support.resolve(u.userId, id, b, meta);
  }
}
