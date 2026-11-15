import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ConversationInfo,
  ConversationMember,
  ConversationMemberList,
  ConversationRole,
  Message,
} from '@caselind/contracts';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { communityBans, conversationMembers, conversations, type MessageRow, users } from '../db/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ContactsService } from './contacts.service.js';
import { toInfo } from './conversations.service.js';
import {
  activeMemberRow,
  appendSystemMessage,
  bestEffort,
  type Exec,
  loadMessage,
  lockConversation,
  requireActiveMember,
  UUID_RE,
  uuidArray,
} from './messaging.shared.js';

const memberNotFound = () => AppError.notFound('Member not found');

/**
 * Group membership. Every mutation runs in a transaction that locks the conversation row, which
 * also serialises sequence numbers: a membership change and a concurrent send cannot interleave.
 */
@Injectable()
export class ConversationMembersService {
  private readonly logger = new Logger(ConversationMembersService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string, conversationId: string): Promise<ConversationMemberList> {
    await requireActiveMember(this.db, conversationId, userId);
    const rows = await this.memberRows(this.db, conversationId);
    return { items: rows.map((r) => toMember(r, userId)) };
  }

  private memberRows(exec: Exec, conversationId: string, onlyUserIds?: string[]) {
    return exec
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        readReceipts: users.readReceipts,
        role: conversationMembers.role,
        joinedAt: conversationMembers.joinedAt,
        lastReadSeq: conversationMembers.lastReadSeq,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.status, 'active'),
          onlyUserIds ? sql`${conversationMembers.userId} = ANY(${uuidArray(onlyUserIds)})` : undefined,
        ),
      )
      .orderBy(asc(conversationMembers.joinedAt), asc(conversationMembers.userId));
  }

  /** Adds users to a group (admin or owner). Already-active members are skipped. Returns the new members. */
  async add(userId: string, conversationId: string, userIds: string[], meta: RequestMeta): Promise<ConversationMemberList> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind !== 'group') throw AppError.forbidden('Members can only be added to a group');
    if (member.role === 'member') throw AppError.forbidden('Only owners and admins can add members');

    const wanted = [...new Set(userIds.map((i) => i.toLowerCase()))].filter((i) => i !== userId.toLowerCase());
    const current = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
    const already = new Set(current.map((c) => c.userId));
    const fresh = wanted.filter((i) => !already.has(i));
    const targets = await this.contacts.resolveTargets(userId, fresh);
    for (const t of targets) await this.contacts.assertAllowed(userId, t);

    const result = await this.db.transaction(async (tx) => {
      const conv = await lockConversation(tx, conversationId);
      const me = await activeMemberRow(tx, conversationId, userId);
      if (!me || me.role === 'member') throw me ? AppError.forbidden('Only owners and admins can add members') : AppError.notFound('Conversation not found');
      const [active] = await tx
        .select({ n: count() })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
      const stillFresh: string[] = [];
      for (const id of fresh) if (!(await activeMemberRow(tx, conversationId, id))) stillFresh.push(id);
      if ((active?.n ?? 0) + stillFresh.length > this.env.MESSAGING_GROUP_MAX_MEMBERS) {
        throw AppError.conflict(`A group has at most ${this.env.MESSAGING_GROUP_MAX_MEMBERS} members`, {
          reason: 'group_full',
          max: this.env.MESSAGING_GROUP_MAX_MEMBERS,
        });
      }
      const systems: MessageRow[] = [];
      for (const id of stillFresh) {
        await tx.delete(communityBans).where(and(eq(communityBans.conversationId, conversationId), eq(communityBans.userId, id)));
        // A returning member starts afresh: no history from their absence, nothing unread.
        const values = {
          conversationId,
          userId: id,
          role: 'member' as const,
          status: 'active' as const,
          joinedAt: new Date(),
          leftAt: null,
          firstSeq: conv.lastSeq + 1 + systems.length,
          lastDeliveredSeq: conv.lastSeq + systems.length,
          lastReadSeq: conv.lastSeq + systems.length,
          mutedUntil: null,
          pinned: false,
          archived: false,
        };
        await tx
          .insert(conversationMembers)
          .values(values)
          .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: values });
        systems.push(await appendSystemMessage(tx, conversationId, { type: 'member_added', userId: id, actorId: userId, title: null }));
      }
      if (stillFresh.length > 0) {
        await this.audit.record(
          { action: 'conversation.member_added', actorUserId: userId, meta, metadata: { conversationId, userIds: stillFresh } },
          tx,
        );
      }
      const [total] = await tx
        .select({ n: count() })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
      return { added: stillFresh, systems, memberCount: total?.n ?? 0, conv };
    });

    if (result.added.length > 0) {
      this.realtime.addToConversation(result.added, conversationId);
      await bestEffort(this.logger, 'member_added events', () =>
        this.emitAfter(conversationId, result.conv.id, result.systems, result.memberCount),
      );
      for (const id of result.added) this.realtime.emitToConversation(conversationId, 'conversation.member_added', { conversationId, userId: id });
    }
    const rows = result.added.length === 0 ? [] : await this.memberRows(this.db, conversationId, result.added);
    return { items: rows.map((r) => toMember(r, userId)) };
  }

  /** Owner only. At least one owner must remain (409 `last_owner`). */
  async setRole(userId: string, conversationId: string, targetId: string, role: ConversationRole, meta: RequestMeta): Promise<ConversationMember> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    if (!UUID_RE.test(targetId)) throw memberNotFound();
    if (conversation.kind !== 'group') throw AppError.forbidden('Direct conversations have no roles');
    if (member.role !== 'owner') throw AppError.forbidden('Only an owner can change roles');
    await this.db.transaction(async (tx) => {
      await lockConversation(tx, conversationId);
      const me = await activeMemberRow(tx, conversationId, userId);
      if (!me) throw AppError.notFound('Conversation not found');
      if (me.role !== 'owner') throw AppError.forbidden('Only an owner can change roles');
      const target = await activeMemberRow(tx, conversationId, targetId);
      if (!target) throw memberNotFound();
      if (target.role === role) return;
      if (target.role === 'owner' && (await this.otherOwners(tx, conversationId, targetId)) === 0) {
        throw AppError.conflict('A conversation needs at least one owner', { reason: 'last_owner' });
      }
      await tx
        .update(conversationMembers)
        .set({ role })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetId)));
      await this.audit.record(
        {
          action: 'conversation.member_role_changed',
          actorUserId: userId,
          meta,
          metadata: { conversationId, targetUserId: targetId, from: target.role, to: role },
        },
        tx,
      );
    });
    const [row] = await this.memberRows(this.db, conversationId, [targetId]);
    return toMember(row!, userId);
  }

  /** Leave (own id) or remove someone (admin or owner; an admin cannot remove an owner). */
  async remove(userId: string, conversationId: string, targetId: string, meta: RequestMeta): Promise<void> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    if (!UUID_RE.test(targetId)) throw memberNotFound();
    if (conversation.kind !== 'group') throw AppError.forbidden('You cannot leave a direct conversation');
    const self = targetId.toLowerCase() === userId.toLowerCase();
    if (!self && member.role === 'member') throw AppError.forbidden('Only owners and admins can remove members');

    const out = await this.db.transaction(async (tx) => {
      await lockConversation(tx, conversationId);
      const me = await activeMemberRow(tx, conversationId, userId);
      if (!me) throw AppError.notFound('Conversation not found');
      if (!self && me.role === 'member') throw AppError.forbidden('Only owners and admins can remove members');
      const target = self ? me : await activeMemberRow(tx, conversationId, targetId);
      if (!target) throw memberNotFound();
      if (!self && target.role === 'owner' && me.role !== 'owner') throw AppError.forbidden('Only an owner can remove an owner');

      let newOwner: string | null = null;
      if (target.role === 'owner' && (await this.otherOwners(tx, conversationId, target.userId)) === 0) {
        // Ownership goes to the longest-standing admin, else the longest-standing member.
        const [heir] = await tx
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              eq(conversationMembers.status, 'active'),
              sql`${conversationMembers.userId} <> ${target.userId}`,
            ),
          )
          .orderBy(sql`(${conversationMembers.role} = 'admin') DESC`, asc(conversationMembers.joinedAt), asc(conversationMembers.userId))
          .limit(1);
        if (heir) {
          newOwner = heir.userId;
          await tx
            .update(conversationMembers)
            .set({ role: 'owner' })
            .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, heir.userId)));
        }
      }
      await tx
        .update(conversationMembers)
        .set({ status: 'left', leftAt: new Date(), role: 'member' })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, target.userId)));
      if (!self) await tx.insert(communityBans).values({ conversationId, userId: target.userId }).onConflictDoNothing();
      const system = await appendSystemMessage(tx, conversationId, {
        type: self ? 'member_left' : 'member_removed',
        userId: target.userId,
        actorId: userId,
        title: null,
      });
      await this.audit.record(
        {
          action: 'conversation.member_removed',
          actorUserId: userId,
          meta,
          metadata: { conversationId, targetUserId: target.userId, self, ...(newOwner && { newOwnerId: newOwner }) },
        },
        tx,
      );
      const [total] = await tx
        .select({ n: count() })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
      const [conv] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
      return { system, memberCount: total?.n ?? 0, conv: conv!, removedId: target.userId };
    });

    // The removed user still gets the event that explains it, then leaves the room.
    // Whatever happens to the events, the removed user's sockets must leave the room.
    try {
      await bestEffort(this.logger, 'member_removed events', () =>
        this.emitAfter(conversationId, out.conv.id, [out.system], out.memberCount),
      );
      this.realtime.emitToConversation(conversationId, 'conversation.member_removed', { conversationId, userId: out.removedId });
    } finally {
      this.realtime.removeFromConversation(out.removedId, conversationId);
    }
  }

  private async otherOwners(exec: Exec, conversationId: string, exceptUserId: string): Promise<number> {
    const [row] = await exec
      .select({ n: count() })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.status, 'active'),
          eq(conversationMembers.role, 'owner'),
          sql`${conversationMembers.userId} <> ${exceptUserId}`,
        ),
      );
    return row?.n ?? 0;
  }

  private async emitAfter(conversationId: string, _id: string, systems: MessageRow[], memberCount: number): Promise<void> {
    for (const s of systems) {
      const dto: Message = await loadMessage(this.db, s, null);
      this.realtime.emitToConversation(conversationId, 'message.new', dto);
    }
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (conv) {
      const info: ConversationInfo = toInfo(conv, memberCount);
      this.realtime.emitToConversation(conversationId, 'conversation.updated', info);
    }
  }
}

function toMember(
  r: {
    userId: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    readReceipts: boolean;
    role: ConversationRole;
    joinedAt: Date;
    lastReadSeq: number;
  },
  viewerId: string,
): ConversationMember {
  return {
    userId: r.userId,
    handle: r.handle,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
    lastReadSeq: r.userId === viewerId || r.readReceipts ? r.lastReadSeq : null,
  };
}
