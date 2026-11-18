import { z } from 'zod';
import { pollSchema } from './messaging-polls.js';

/* Lot 3A: messaging (conversations, messages, receipts). See docs/architecture/API_CONTRACTS.md. */

export const conversationKindSchema = z.enum(['direct', 'group']);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

export const conversationRoleSchema = z.enum(['owner', 'admin', 'member']);
export type ConversationRole = z.infer<typeof conversationRoleSchema>;

export const messageKindSchema = z.enum(['text', 'media', 'system', 'poll']);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const MESSAGE_BODY_MAX = 4000;
export const MESSAGE_MENTIONS_MAX = 50;
export const REACTION_EMOJI_MAX = 16;

const userRefSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type ConversationUserRef = z.infer<typeof userRefSchema>;

export const messageMediaSchema = z.object({
  id: z.uuid(),
  mime: z.string().nullable(),
  sizeBytes: z.number().int(),
  contentUrl: z.string().nullable(),
});
export type MessageMedia = z.infer<typeof messageMediaSchema>;

export const systemEventSchema = z.object({
  type: z.enum(['group_created', 'member_added', 'member_removed', 'member_left', 'title_changed', 'disappearing_changed']),
  /** Member concerned (added, removed, left). */
  userId: z.uuid().nullable(),
  /** Who did it. */
  actorId: z.uuid().nullable(),
  title: z.string().nullable(),
  /** Lot 3b, `disappearing_changed`: the new lifetime in seconds, null = off. */
  seconds: z.number().int().nullable().optional(),
});
export type SystemEvent = z.infer<typeof systemEventSchema>;

export const reactionCountSchema = z.object({ emoji: z.string(), count: z.number().int() });

/** A recalled message keeps its place (seq) but has no body, media or reactions. */
export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  seq: z.number().int(),
  kind: messageKindSchema,
  senderId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  body: z.string().nullable(),
  media: messageMediaSchema.nullable(),
  replyToId: z.uuid().nullable(),
  mentions: z.array(z.uuid()),
  systemEvent: systemEventSchema.nullable(),
  recalled: z.boolean(),
  reactions: z.array(reactionCountSchema),
  /** The caller's own reaction; always null in realtime events (they are not per-user). */
  myReaction: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Lot 3b: forwarded message (the original author is never exposed). */
  forwarded: z.boolean(),
  /** Lot 3b: when a disappearing message stops being served; null = permanent. */
  expiresAt: z.iso.datetime().nullable(),
  /** The caller has favourited this message; always false in realtime events (not per-user). */
  favorited: z.boolean(),
  /** Kind 'poll': the question (also the body), options with counters and the caller's votes; null otherwise. */
  poll: pollSchema.nullable(),
});
export type Message = z.infer<typeof messageSchema>;

export const messageListQuerySchema = z.object({
  beforeSeq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export const messageListSchema = z.object({ items: z.array(messageSchema), hasMore: z.boolean() });
export type MessageList = z.infer<typeof messageListSchema>;

export const sendMessageRequestSchema = z
  .object({
    clientId: z.uuid(),
    kind: z.enum(['text', 'media']),
    body: z.string().max(MESSAGE_BODY_MAX).optional(),
    mediaId: z.uuid().optional(),
    replyToId: z.uuid().optional(),
    mentions: z.array(z.uuid()).max(MESSAGE_MENTIONS_MAX).optional(),
    /** Lot 3b: deferred sending, from 1 minute to 30 days ahead. */
    scheduledAt: z.iso.datetime().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'text') {
      if (!v.body || v.body.trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['body'], message: 'body is required (1 to 4000 characters)' });
      }
      if (v.mediaId) ctx.addIssue({ code: 'custom', path: ['mediaId'], message: 'not allowed for a text message' });
    } else if (!v.mediaId) {
      ctx.addIssue({ code: 'custom', path: ['mediaId'], message: 'mediaId is required for a media message' });
    }
  });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const reactionRequestSchema = z.object({
  emoji: z.string().min(1).max(REACTION_EMOJI_MAX).nullable(),
});
export type ReactionRequest = z.infer<typeof reactionRequestSchema>;

export const recallQuerySchema = z.object({ scope: z.enum(['me', 'all']).default('me') });
export type RecallQuery = z.infer<typeof recallQuerySchema>;

/** The caller's view of a conversation. */
export const conversationSchema = z.object({
  id: z.uuid(),
  kind: conversationKindSchema,
  title: z.string().nullable(),
  announcement: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** Direct conversations: the other user. */
  peer: userRefSchema.nullable(),
  memberCount: z.number().int(),
  myRole: conversationRoleSchema,
  lastSeq: z.number().int(),
  lastMessage: messageSchema.nullable(),
  unreadCount: z.number().int(),
  myLastReadSeq: z.number().int(),
  mutedUntil: z.iso.datetime().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  /** Lot 3b: lifetime of new messages in seconds (86400, 604800, 7776000); null = permanent. */
  disappearingSeconds: z.number().int().nullable(),
  /** The caller's unsent draft in this conversation, or null. */
  draft: z.object({ body: z.string(), updatedAt: z.iso.datetime() }).nullable(),
  lastActivityAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationListQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

const titleSchema = z.string().trim().min(1).max(100);
const announcementSchema = z.string().trim().max(1000);

export const createConversationRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct'), userId: z.uuid() }),
  z.object({
    kind: z.literal('group'),
    title: titleSchema,
    announcement: announcementSchema.optional(),
    avatarAssetId: z.uuid().optional(),
    memberIds: z.array(z.uuid()).max(499).default([]),
  }),
]);
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const updateConversationRequestSchema = z
  .object({
    title: titleSchema.optional(),
    announcement: announcementSchema.nullable().optional(),
    avatarAssetId: z.uuid().nullable().optional(),
    /** Lot 3b: disappearing messages; a direct conversation accepts only this field. */
    disappearingSeconds: z.union([z.literal(86400), z.literal(604800), z.literal(7776000)]).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateConversationRequest = z.infer<typeof updateConversationRequestSchema>;

export const updateMyConversationStateRequestSchema = z
  .object({
    mutedUntil: z.iso.datetime().nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateMyConversationStateRequest = z.infer<typeof updateMyConversationStateRequestSchema>;

export const receiptRequestSchema = z.object({ seq: z.number().int().min(0) });
export type ReceiptRequest = z.infer<typeof receiptRequestSchema>;

export const receiptStateSchema = z.object({
  conversationId: z.uuid(),
  lastDeliveredSeq: z.number().int(),
  lastReadSeq: z.number().int(),
  unreadCount: z.number().int(),
});
export type ReceiptState = z.infer<typeof receiptStateSchema>;

/** `receipt.updated` event: lastReadSeq is null when that user disabled read receipts. */
export const receiptEventSchema = z.object({
  conversationId: z.uuid(),
  userId: z.uuid(),
  lastDeliveredSeq: z.number().int(),
  lastReadSeq: z.number().int().nullable(),
});
export type ReceiptEvent = z.infer<typeof receiptEventSchema>;

export const conversationMemberSchema = userRefSchema.extend({
  role: conversationRoleSchema,
  joinedAt: z.iso.datetime(),
  /** Hidden (null) for other users who turned read receipts off. */
  lastReadSeq: z.number().int().nullable(),
});
export type ConversationMember = z.infer<typeof conversationMemberSchema>;

export const conversationMemberListSchema = z.object({ items: z.array(conversationMemberSchema) });
export type ConversationMemberList = z.infer<typeof conversationMemberListSchema>;

export const addConversationMembersRequestSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(50),
});
export type AddConversationMembersRequest = z.infer<typeof addConversationMembersRequestSchema>;

export const updateConversationMemberRequestSchema = z.object({ role: conversationRoleSchema });
export type UpdateConversationMemberRequest = z.infer<typeof updateConversationMemberRequestSchema>;

/** `conversation.updated` event payload (not per-user). */
export const conversationInfoSchema = z.object({
  id: z.uuid(),
  kind: conversationKindSchema,
  title: z.string().nullable(),
  announcement: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  memberCount: z.number().int(),
  disappearingSeconds: z.number().int().nullable(),
});
export type ConversationInfo = z.infer<typeof conversationInfoSchema>;

export const messageReactionEventSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  userId: z.uuid(),
  emoji: z.string().nullable(),
  reactions: z.array(reactionCountSchema),
});
export type MessageReactionEvent = z.infer<typeof messageReactionEventSchema>;

export const exportedConversationSchema = z.object({
  id: z.uuid(),
  kind: conversationKindSchema,
  role: conversationRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const exportedMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  kind: messageKindSchema,
  body: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
