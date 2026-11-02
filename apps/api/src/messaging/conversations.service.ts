import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Conversation,
  type ConversationInfo,
  type ConversationList,
  type ConversationListQuery,
  type CreateConversationRequest,
  type Message,
  type ReceiptEvent,
  type ReceiptState,
  type UpdateConversationRequest,
  type UpdateMyConversationStateRequest,
} from '@caselind/contracts';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import {
  type ConversationMemberRow,
  conversationMembers,
  type ConversationRow,
  conversations,
  mediaAssets,
  type MessageRow,
  messages,
  users,
} from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import { pgErrorOf } from '../orgs/orgs.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ENV, type Env } from '../config/env.js';
import { ContactsService } from './contacts.service.js';
import {
  activeMemberRow,
  appendSystemMessage,
  bestEffort,
  directKeyOf,
  type Exec,
  loadMessage,
  loadMessages,
  lockConversation,
  requireActiveMember,
  UUID_RE,
  userNotFound,
  uuidArray,
  validationError,
} from './messaging.shared.js';

export function toInfo(c: ConversationRow, memberCount: number): ConversationInfo {
  return {
    id: c.id,
    kind: c.kind,
    title: c.title,
    announcement: c.announcement,
    avatarUrl: c.avatarUrl,
    memberCount,
  };
}

interface ListCursor {
  pinned: boolean;
  activity: string;
  id: string;
}

function encodeCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify([c.pinned, c.activity, c.id])).toString('base64url');
}

function decodeCursor(cursor: string): ListCursor {
  try {
    const [pinned, activity, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof pinned === 'boolean' && typeof activity === 'string' && typeof id === 'string' && UUID_RE.test(id) && !Number.isNaN(Date.parse(activity))) {
      return { pinned, activity, id };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}

/** Conversations: creation, the caller's list and state, group profile, delivery and read receipts. */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly privacy: PrivacyService,
    private readonly contacts: ContactsService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ------------------------------------------------------------------ creation */

  /** Direct: idempotent (the existing conversation is returned with created=false). */
  async create(
    userId: string,
    body: CreateConversationRequest,
    meta: RequestMeta,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    return body.kind === 'direct' ? this.createDirect(userId, body.userId) : this.createGroup(userId, body, meta);
  }

  private async createDirect(userId: string, targetId: string): Promise<{ conversation: Conversation; created: boolean }> {
    if (targetId.toLowerCase() === userId.toLowerCase()) throw validationError('userId', 'cannot start a conversation with yourself');
    const target = await this.contacts.resolveDirectTarget(userId, targetId);
    const key = directKeyOf(userId, targetId);
    const findExisting = async () => {
      const [row] = await this.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.directKey, key)).limit(1);
      return row?.id;
    };
    const existing = await findExisting();
    if (existing) {
      return { conversation: await this.getFor(userId, existing), created: false };
    }
    await this.contacts.assertAllowed(userId, target);
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const [conv] = await tx
          .insert(conversations)
          .values({ kind: 'direct', directKey: key, createdBy: userId })
          .returning({ id: conversations.id });
        await tx.insert(conversationMembers).values([
          { conversationId: conv!.id, userId },
          { conversationId: conv!.id, userId: targetId },
        ]);
        return conv!.id;
      });
    } catch (err) {
      if (pgErrorOf(err).code === '23505') {
        const raced = await findExisting();
        if (raced) return { conversation: await this.getFor(userId, raced), created: false };
      }
      if (pgErrorOf(err).code === '23503') throw userNotFound();
      throw err;
    }
    this.realtime.addToConversation([userId, targetId], id);
    return { conversation: await this.getFor(userId, id), created: true };
  }

  private async createGroup(
    userId: string,
    body: Extract<CreateConversationRequest, { kind: 'group' }>,
    meta: RequestMeta,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const memberIds = [...new Set(body.memberIds.map((m) => m.toLowerCase()))].filter((m) => m !== userId.toLowerCase());
    if (memberIds.length + 1 > this.env.MESSAGING_GROUP_MAX_MEMBERS) throw this.groupFull();
    const targets = await this.contacts.resolveTargets(userId, memberIds);
    for (const t of targets) await this.contacts.assertAllowed(userId, t);
    const avatarUrl = body.avatarAssetId ? await this.avatarUrlFor(userId, body.avatarAssetId) : null;

    const { id, system } = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(conversations)
        .values({ kind: 'group', title: body.title, announcement: body.announcement || null, avatarUrl, createdBy: userId })
        .returning({ id: conversations.id });
      await tx.insert(conversationMembers).values([
        { conversationId: conv!.id, userId, role: 'owner' },
        ...memberIds.map((m) => ({ conversationId: conv!.id, userId: m })),
      ]);
      const sys = await appendSystemMessage(tx, conv!.id, { type: 'group_created', userId: null, actorId: userId, title: body.title });
      // The author has "read" the creation event; the others see it as unread-free (system messages never count).
      await this.audit.record(
        { action: 'conversation.group_created', actorUserId: userId, meta, metadata: { conversationId: conv!.id, memberCount: memberIds.length + 1 } },
        tx,
      );
      return { id: conv!.id, system: sys };
    });
    this.realtime.addToConversation([userId, ...memberIds], id);
    await bestEffort(this.logger, 'group_created event', async () =>
      this.realtime.emitToConversation(id, 'message.new', await loadMessage(this.db, system, null)),
    );
    return { conversation: await this.getFor(userId, id), created: true };
  }

  groupFull(): AppError {
    return AppError.conflict(`A group has at most ${this.env.MESSAGING_GROUP_MAX_MEMBERS} members`, {
      reason: 'group_full',
      max: this.env.MESSAGING_GROUP_MAX_MEMBERS,
    });
  }

  /** A ready `avatar` upload owned by the user, else 400. */
  async avatarUrlFor(userId: string, assetId: string): Promise<string> {
    const [asset] = await this.db
      .select({ id: mediaAssets.id, ownerUserId: mediaAssets.ownerUserId, purpose: mediaAssets.purpose, status: mediaAssets.status })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    if (!asset || asset.ownerUserId !== userId || asset.purpose !== 'avatar' || asset.status !== 'ready') {
      throw validationError('avatarAssetId', 'must be a ready upload with purpose "avatar"');
    }
    return contentUrlOf(asset.id);
  }

  /* ------------------------------------------------------------------ reading */

  async getFor(userId: string, conversationId: string): Promise<Conversation> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    return (await this.summaries(this.db, userId, [{ conversation, member }]))[0]!;
  }

  async list(userId: string, q: ConversationListQuery): Promise<ConversationList> {
    const cur = q.cursor ? decodeCursor(q.cursor) : undefined;
    const activity = sql`COALESCE(c.last_message_at, c.created_at)`;
    const res = await this.db.execute<{ id: string; pinned: boolean; act: string }>(sql`
      SELECT id, pinned, act FROM (
        SELECT c.id, cm.pinned, ${activity}::text AS act, ${activity} AS act_ts
        FROM conversation_members cm
        JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.user_id = ${userId} AND cm.status = 'active' AND cm.archived = ${q.archived}
          AND (c.kind = 'group' OR c.last_seq > 0 OR c.created_by = ${userId})
      ) t
      ${cur ? sql`WHERE (t.pinned, t.act_ts, t.id) < (${cur.pinned}::boolean, ${cur.activity}::timestamptz, ${cur.id}::uuid)` : sql``}
      ORDER BY t.pinned DESC, t.act_ts DESC, t.id DESC
      LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const ids = page.map((r) => r.id);
    const rows =
      ids.length === 0
        ? []
        : await this.db
            .select({ conversation: conversations, member: conversationMembers })
            .from(conversationMembers)
            .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
            .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, ids)));
    const byId = new Map(rows.map((r) => [r.conversation.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
    const items = await this.summaries(this.db, userId, ordered);
    const last = page.at(-1);
    return {
      items,
      nextCursor: res.rows.length > q.limit && last ? encodeCursor({ pinned: last.pinned, activity: last.act, id: last.id }) : null,
    };
  }

  /** The caller's view of each conversation, with batched lookups (members, peers, last message, unread). */
  async summaries(
    exec: Exec,
    userId: string,
    rows: { conversation: ConversationRow; member: ConversationMemberRow }[],
  ): Promise<Conversation[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.conversation.id);
    const counts = await exec
      .select({ id: conversationMembers.conversationId, n: count() })
      .from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, ids), eq(conversationMembers.status, 'active')))
      .groupBy(conversationMembers.conversationId);
    const countById = new Map(counts.map((c) => [c.id, c.n]));

    const directIds = rows.filter((r) => r.conversation.kind === 'direct').map((r) => r.conversation.id);
    const peers =
      directIds.length === 0
        ? []
        : await exec
            .select({
              conversationId: conversationMembers.conversationId,
              userId: users.id,
              handle: users.handle,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
            })
            .from(conversationMembers)
            .innerJoin(users, eq(users.id, conversationMembers.userId))
            .where(and(inArray(conversationMembers.conversationId, directIds), sql`${conversationMembers.userId} <> ${userId}`));
    const peerById = new Map(peers.map((p) => [p.conversationId, p]));

    const lastRes = await exec.execute<{ id: string }>(sql`
      SELECT DISTINCT ON (m.conversation_id) m.id
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}
      WHERE m.conversation_id = ANY(${uuidArray(ids)}) AND m.seq >= cm.first_seq
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ${userId})
      ORDER BY m.conversation_id, m.seq DESC`);
    const lastRows: MessageRow[] =
      lastRes.rows.length === 0 ? [] : await exec.select().from(messages).where(inArray(messages.id, lastRes.rows.map((r) => r.id)));
    const lastMessages = await loadMessages(exec, lastRows, userId);
    const lastById = new Map<string, Message>(lastMessages.map((m) => [m.conversationId, m]));

    const unread = await this.unreadCounts(exec, userId, ids);

    return rows.map(({ conversation: c, member: m }) => {
      const peer = peerById.get(c.id);
      return {
        id: c.id,
        kind: c.kind,
        title: c.title,
        announcement: c.announcement,
        avatarUrl: c.avatarUrl,
        peer: peer ? { userId: peer.userId, handle: peer.handle, displayName: peer.displayName, avatarUrl: peer.avatarUrl } : null,
        memberCount: countById.get(c.id) ?? 0,
        myRole: m.role,
        lastSeq: c.lastSeq,
        lastMessage: lastById.get(c.id) ?? null,
        unreadCount: unread.get(c.id) ?? 0,
        myLastReadSeq: m.lastReadSeq,
        mutedUntil: m.mutedUntil?.toISOString() ?? null,
        pinned: m.pinned,
        archived: m.archived,
        lastActivityAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  /** Messages of others (not system, not recalled, not hidden by the user) after the user's read position. */
  async unreadCounts(exec: Exec, userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    const res = await exec.execute<{ conversation_id: string; n: number }>(sql`
      SELECT m.conversation_id, count(*)::int AS n
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}
      WHERE m.conversation_id = ANY(${uuidArray(conversationIds)})
        AND m.seq > cm.last_read_seq AND m.seq >= cm.first_seq
        AND m.kind <> 'system' AND m.recalled_at IS NULL AND m.sender_id IS DISTINCT FROM ${userId}
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ${userId})
      GROUP BY m.conversation_id`);
    return new Map(res.rows.map((r) => [r.conversation_id, r.n]));
  }

  /* ------------------------------------------------------------------ updates */

  /** Title, announcement, avatar of a group (admin or owner). */
  async update(userId: string, conversationId: string, patch: UpdateConversationRequest): Promise<Conversation> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind !== 'group') throw AppError.forbidden('Only groups have a profile');
    if (member.role === 'member') throw AppError.forbidden('Only owners and admins can edit the group');
    const avatarUrl =
      patch.avatarAssetId === undefined ? undefined : patch.avatarAssetId === null ? null : await this.avatarUrlFor(userId, patch.avatarAssetId);

    const out = await this.db.transaction(async (tx) => {
      await lockConversation(tx, conversationId);
      if (!(await activeMemberRow(tx, conversationId, userId))) throw AppError.notFound('Conversation not found');
      const [updated] = await tx
        .update(conversations)
        .set({
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.announcement !== undefined && { announcement: patch.announcement || null }),
          ...(avatarUrl !== undefined && { avatarUrl }),
        })
        .where(eq(conversations.id, conversationId))
        .returning();
      const titleChanged = patch.title !== undefined && patch.title !== conversation.title;
      const system = titleChanged
        ? await appendSystemMessage(tx, conversationId, { type: 'title_changed', userId: null, actorId: userId, title: patch.title ?? null })
        : null;
      const [counted] = await tx
        .select({ n: count() })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
      return { updated: updated!, system, memberCount: counted?.n ?? 0 };
    });
    this.realtime.emitToConversation(conversationId, 'conversation.updated', toInfo(out.updated, out.memberCount));
    const system = out.system;
    if (system) {
      await bestEffort(this.logger, 'title_changed event', async () =>
        this.realtime.emitToConversation(conversationId, 'message.new', await loadMessage(this.db, system, null)),
      );
    }
    return this.getFor(userId, conversationId);
  }

  /** Mute, pin, archive: the caller's own state only. */
  async updateMyState(userId: string, conversationId: string, patch: UpdateMyConversationStateRequest): Promise<Conversation> {
    await requireActiveMember(this.db, conversationId, userId);
    await this.db
      .update(conversationMembers)
      .set({
        ...(patch.mutedUntil !== undefined && { mutedUntil: patch.mutedUntil === null ? null : new Date(patch.mutedUntil) }),
        ...(patch.pinned !== undefined && { pinned: patch.pinned }),
        ...(patch.archived !== undefined && { archived: patch.archived }),
      })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return this.getFor(userId, conversationId);
  }

  /* ------------------------------------------------------------------ receipts */

  /**
   * Monotone and bounded by the last sequence number. A read position also counts as delivered.
   * `receipt.updated` hides lastReadSeq when the user turned read receipts off (the unread
   * counter still works: the position is stored either way).
   */
  async receipt(userId: string, conversationId: string, kind: 'delivered' | 'read', seq: number): Promise<ReceiptState> {
    const { member } = await requireActiveMember(this.db, conversationId, userId);
    const res = await this.db.execute<{ delivered: number; read_seq: number }>(sql`
      UPDATE conversation_members cm SET
        last_delivered_seq = GREATEST(cm.last_delivered_seq, LEAST(${seq}::bigint, c.last_seq)),
        last_read_seq = ${kind === 'read' ? sql`GREATEST(cm.last_read_seq, LEAST(${seq}::bigint, c.last_seq))` : sql`cm.last_read_seq`}
      FROM conversations c
      WHERE c.id = cm.conversation_id AND cm.conversation_id = ${conversationId} AND cm.user_id = ${userId}
      RETURNING cm.last_delivered_seq::int AS delivered, cm.last_read_seq::int AS read_seq`);
    const now = res.rows[0]!;
    const unread = (await this.unreadCounts(this.db, userId, [conversationId])).get(conversationId) ?? 0;
    if (now.delivered !== member.lastDeliveredSeq || now.read_seq !== member.lastReadSeq) {
      void this.emitReceipt(userId, conversationId, now.delivered, now.read_seq);
    }
    return { conversationId, lastDeliveredSeq: now.delivered, lastReadSeq: now.read_seq, unreadCount: unread };
  }

  private async emitReceipt(userId: string, conversationId: string, delivered: number, read: number): Promise<void> {
    try {
      const [u] = await this.db.select({ readReceipts: users.readReceipts }).from(users).where(eq(users.id, userId)).limit(1);
      const event: ReceiptEvent = {
        conversationId,
        userId,
        lastDeliveredSeq: delivered,
        lastReadSeq: u?.readReceipts === false ? null : read,
      };
      this.realtime.emitToConversation(conversationId, 'receipt.updated', event);
    } catch (err) {
      this.logger.warn(`receipt event not emitted: ${(err as Error).name}`);
    }
  }
}
