import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents } from '../db/schema.js';
import { Roles } from '../security/auth.guard.js';

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** id of the last event of the previous page */
  before: z.coerce.bigint().positive().optional(),
  action: z.string().max(100).optional(),
  subjectUserId: z.uuid().optional(),
});

/** Global back-office. Every route requires the `admin` platform role, checked server-side. */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('audit-events')
  async auditEvents(@Query(new ZodPipe(auditQuerySchema)) q: z.output<typeof auditQuerySchema>) {
    const filters: SQL[] = [];
    if (q.before) filters.push(lt(auditEvents.id, q.before));
    if (q.action) filters.push(eq(auditEvents.action, q.action));
    if (q.subjectUserId) filters.push(eq(auditEvents.subjectUserId, q.subjectUserId));
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(q.limit);
    const items = rows.map((r) => ({ ...r, id: r.id.toString(), occurredAt: r.occurredAt.toISOString() }));
    return { items, nextCursor: rows.length === q.limit ? items.at(-1)!.id : null };
  }
}
