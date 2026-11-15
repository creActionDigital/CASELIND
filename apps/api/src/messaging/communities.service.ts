import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Community, CommunityList, CommunityListQuery, PublishCommunityRequest, TrendingTags } from '@caselind/contracts';
import { and, count, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { communities, communityBans, conversationMembers, conversations, type MessageRow } from '../db/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { toInfo } from './conversations.service.js';
import { activeMemberRow, appendSystemMessage, bestEffort, loadMessage, lockConversation, requireActiveMember, UUID_RE, validationError } from './messaging.shared.js';

const notFound = () => AppError.notFound('Community not found');

type Row = {
  conversation_id: string;
  title: string;
  avatar_url: string | null;
  description: string;
  tags: string[];
  member_count: number;
  joined: boolean;
};
const toCommunity = (r: Row): Community => ({
  conversationId: r.conversation_id,
  title: r.title,
  avatarUrl: r.avatar_url,
  description: r.description,
  tags: r.tags,
  memberCount: Number(r.member_count),
  joined: r.joined,
});

/**
 * Public communities: a group its owner chose to publish. Everything else (members, roles, messages,
 * removal, limits) is the group's own logic; this service only lists, publishes and lets people join.
 */
@Injectable()
export class CommunitiesService {
  private readonly logger = new Logger(CommunitiesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Owner only. Publishing again updates the description and tags. */
  async publish(userId: string, conversationId: string, body: PublishCommunityRequest, meta: RequestMeta): Promise<Community> {
    const { conversation, member } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind !== 'group') throw AppError.forbidden('Only a group can be published');
    if (member.role !== 'owner') throw AppError.forbidden('Only an owner can publish a community');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(communities)
        .values({ conversationId, description: body.description, tags: body.tags })
        .onConflictDoUpdate({ target: communities.conversationId, set: { description: body.description, tags: body.tags } });
      await this.audit.record({ action: 'community.published', actorUserId: userId, meta, metadata: { conversationId, tags: body.tags } }, tx);
    });
    return this.get(userId, conversationId);
  }

  /** Owner only. The group stays, with its members; it just leaves the public listing. */
  async unpublish(userId: string, conversationId: string, meta: RequestMeta): Promise<void> {
    const { member } = await requireActiveMember(this.db, conversationId, userId);
    if (member.role !== 'owner') throw AppError.forbidden('Only an owner can unpublish a community');
    await this.db.transaction(async (tx) => {
      const del = await tx.delete(communities).where(eq(communities.conversationId, conversationId)).returning({ id: communities.conversationId });
      if (del.length > 0) await this.audit.record({ action: 'community.unpublished', actorUserId: userId, meta, metadata: { conversationId } }, tx);
    });
  }

  async get(userId: string, conversationId: string): Promise<Community> {
    if (!UUID_RE.test(conversationId)) throw notFound();
    const res = await this.db.execute<Row>(sql`${this.baseQuery(userId)} WHERE c.id = ${conversationId}::uuid`);
    const row = res.rows[0];
    if (!row) throw notFound();
    return toCommunity(row);
  }

  async list(userId: string, q: CommunityListQuery): Promise<CommunityList> {
    const offset = decodeOffset(q.cursor);
    const filters = [sql`TRUE`];
    if (q.q) filters.push(sql`(c.title ILIKE ${'%' + escapeLike(q.q) + '%'} OR cm.description ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    if (q.tag) filters.push(sql`${q.tag} = ANY (cm.tags)`);
    const res = await this.db.execute<Row>(sql`
      ${this.baseQuery(userId)}
      WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY member_count DESC, c.title, c.id
      LIMIT ${q.limit + 1} OFFSET ${offset}`);
    const page = res.rows.slice(0, q.limit);
    return { items: page.map(toCommunity), nextCursor: res.rows.length > q.limit ? String(offset + q.limit) : null };
  }

  async trendingTags(): Promise<TrendingTags> {
    const res = await this.db.execute<{ tag: string; communities: number }>(sql`
      SELECT t AS tag, count(*)::int AS communities FROM communities, unnest(tags) AS t
      GROUP BY t ORDER BY communities DESC, tag LIMIT 10`);
    return { items: res.rows.map((r) => ({ tag: r.tag, communities: Number(r.communities) })) };
  }

  /** Idempotent. 403 for someone removed by an admin, 409 when the group is full. */
  async join(userId: string, conversationId: string, meta: RequestMeta): Promise<Community> {
    if (!UUID_RE.test(conversationId)) throw notFound();
    const out = await this.db.transaction(async (tx) => {
      const conv = await lockConversation(tx, conversationId).catch(() => {
        throw notFound();
      });
      const [published] = await tx.select({ id: communities.conversationId }).from(communities).where(eq(communities.conversationId, conversationId));
      if (!published) throw notFound();
      if (await activeMemberRow(tx, conversationId, userId)) return null;
      const [banned] = await tx
        .select({ id: communityBans.userId })
        .from(communityBans)
        .where(and(eq(communityBans.conversationId, conversationId), eq(communityBans.userId, userId)));
      if (banned) throw AppError.forbidden('You were removed from this community');
      const [active] = await tx
        .select({ n: count() })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')));
      if ((active?.n ?? 0) + 1 > this.env.MESSAGING_GROUP_MAX_MEMBERS) {
        throw AppError.conflict(`A group has at most ${this.env.MESSAGING_GROUP_MAX_MEMBERS} members`, { reason: 'group_full', max: this.env.MESSAGING_GROUP_MAX_MEMBERS });
      }
      const values = {
        conversationId,
        userId,
        role: 'member' as const,
        status: 'active' as const,
        joinedAt: new Date(),
        leftAt: null,
        firstSeq: conv.lastSeq + 1,
        lastDeliveredSeq: conv.lastSeq,
        lastReadSeq: conv.lastSeq,
        mutedUntil: null,
        pinned: false,
        archived: false,
      };
      await tx
        .insert(conversationMembers)
        .values(values)
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: values });
      const system = await appendSystemMessage(tx, conversationId, { type: 'member_added', userId, actorId: userId, title: null });
      await this.audit.record({ action: 'community.joined', actorUserId: userId, meta, metadata: { conversationId } }, tx);
      return { system, memberCount: (active?.n ?? 0) + 1, conv };
    });
    if (out) {
      this.realtime.addToConversation([userId], conversationId);
      await bestEffort(this.logger, 'community_joined events', () => this.emitJoined(conversationId, out.system, out.memberCount));
      this.realtime.emitToConversation(conversationId, 'conversation.member_added', { conversationId, userId });
    }
    return this.get(userId, conversationId);
  }

  private async emitJoined(conversationId: string, system: MessageRow, memberCount: number): Promise<void> {
    this.realtime.emitToConversation(conversationId, 'message.new', await loadMessage(this.db, system, null));
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (conv) this.realtime.emitToConversation(conversationId, 'conversation.updated', toInfo(conv, memberCount));
  }

  private baseQuery(userId: string) {
    return sql`
      SELECT c.id AS conversation_id, c.title, c.avatar_url, cm.description, cm.tags,
        (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id = c.id AND m.status = 'active') AS member_count,
        EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = ${userId}::uuid AND m.status = 'active') AS joined
      FROM communities cm JOIN conversations c ON c.id = cm.conversation_id`;
  }
}

function decodeOffset(cursor: string | undefined): number {
  const n = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(n) || n < 0) throw validationError('cursor', 'Invalid cursor');
  return n;
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
