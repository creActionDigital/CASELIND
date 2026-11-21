import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Put } from '@nestjs/common';
import { MAX_PINNED_MESSAGES, type PinnedMessageList } from '@caselind/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { messages } from '../db/schema.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { loadMessages, NOT_EXPIRED_M, requireActiveMember, UUID_RE } from './messaging.shared.js';

/** Messages epingles : visibles de tous les membres actifs, 10 au plus par conversation. */
@Injectable()
export class MessagePinsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async target(userId: string, messageId: string) {
    if (!UUID_RE.test(messageId)) throw AppError.notFound('Message not found');
    const [row] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!row) throw AppError.notFound('Message not found');
    const { member } = await requireActiveMember(this.db, row.conversationId, userId);
    if (row.seq < member.firstSeq) throw AppError.notFound('Message not found');
    return row;
  }

  async pin(userId: string, messageId: string): Promise<void> {
    const row = await this.target(userId, messageId);
    if (row.recalledAt || row.kind === 'system') throw AppError.conflict('This message cannot be pinned', { reason: 'not_pinnable' });
    const n = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM message_pins WHERE conversation_id = ${row.conversationId}::uuid AND message_id <> ${messageId}::uuid`);
    if ((n.rows[0]?.n ?? 0) >= MAX_PINNED_MESSAGES) throw AppError.conflict('Too many pinned messages', { reason: 'pin_limit', max: MAX_PINNED_MESSAGES });
    await this.db.execute(sql`INSERT INTO message_pins (message_id, conversation_id, pinned_by) VALUES (${messageId}::uuid, ${row.conversationId}::uuid, ${userId}::uuid) ON CONFLICT DO NOTHING`);
  }

  async unpin(userId: string, messageId: string): Promise<void> {
    await this.target(userId, messageId);
    await this.db.execute(sql`DELETE FROM message_pins WHERE message_id = ${messageId}::uuid`);
  }

  async list(userId: string, conversationId: string): Promise<PinnedMessageList> {
    const { member } = await requireActiveMember(this.db, conversationId, userId);
    const res = await this.db.execute<{ message_id: string; pinned_at: string }>(sql`
      SELECT p.message_id, p.pinned_at::text AS pinned_at FROM message_pins p JOIN messages m ON m.id = p.message_id
      WHERE p.conversation_id = ${conversationId}::uuid AND m.seq >= ${member.firstSeq} AND m.recalled_at IS NULL AND ${NOT_EXPIRED_M}
      ORDER BY p.pinned_at DESC`);
    const rows = res.rows.length === 0 ? [] : await this.db.select().from(messages).where(inArray(messages.id, res.rows.map((r) => r.message_id)));
    const dtos = new Map((await loadMessages(this.db, rows, userId)).map((m) => [m.id, m]));
    return { items: res.rows.flatMap((r) => { const message = dtos.get(r.message_id); return message ? [{ message, pinnedAt: new Date(r.pinned_at).toISOString() }] : []; }) };
  }
}

@Controller()
@RequireFlag('messaging')
export class MessagePinsController {
  constructor(private readonly pins: MessagePinsService) {}

  @Put('messages/:id/pin')
  @HttpCode(204)
  async pin(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.pins.pin(user.userId, id);
  }

  @Delete('messages/:id/pin')
  @HttpCode(204)
  async unpin(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.pins.unpin(user.userId, id);
  }

  @Get('conversations/:id/pins')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<PinnedMessageList> {
    return this.pins.list(user.userId, id);
  }
}
