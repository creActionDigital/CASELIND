import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { conversationMembers } from '../db/schema.js';
import { ConversationRoomsResolver } from '../realtime/realtime.service.js';

/** Conversations whose rooms a user's sockets join on connection: the ones they are an active member of. */
@Injectable()
export class MessagingRooms extends ConversationRoomsResolver {
  constructor(@Inject(DB) private readonly db: Db) {
    super();
  }

  async conversationIdsFor(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.userId, userId), eq(conversationMembers.status, 'active')));
    return rows.map((r) => r.id);
  }
}
