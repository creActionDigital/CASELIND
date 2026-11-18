import { z } from 'zod';

/* Conversation polls: a message of kind 'poll'. Voters are anonymous: only counters and the caller's own votes are served. */

export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 80;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
export const POLL_MAX_DAYS_AHEAD = 30;

export const pollOptionSchema = z.object({ id: z.uuid(), label: z.string(), votes: z.number().int() });

export const pollSchema = z.object({
  question: z.string(),
  multiple: z.boolean(),
  options: z.array(pollOptionSchema),
  /** Members who voted at least once (a multiple-choice voter counts once). */
  voters: z.number().int(),
  /** Planned closing time, null = open until the creator closes it. */
  closesAt: z.iso.datetime().nullable(),
  /** Closed by hand or its closing time passed. */
  closed: z.boolean(),
  /** The caller's chosen options; always empty in realtime events (they are not per-user). */
  myVotes: z.array(z.uuid()),
});
export type Poll = z.infer<typeof pollSchema>;

export const createPollRequestSchema = z.object({
  clientId: z.uuid(),
  question: z.string().trim().min(1).max(POLL_QUESTION_MAX),
  options: z.array(z.string().trim().min(1).max(POLL_OPTION_MAX)).min(POLL_OPTIONS_MIN).max(POLL_OPTIONS_MAX),
  multiple: z.boolean().default(false),
  closesAt: z.iso.datetime().optional(),
});
export type CreatePollRequest = z.infer<typeof createPollRequestSchema>;

/** An empty list withdraws the vote. */
export const pollVoteRequestSchema = z.object({ optionIds: z.array(z.uuid()).max(POLL_OPTIONS_MAX) });
export type PollVoteRequest = z.infer<typeof pollVoteRequestSchema>;

/** `message.poll` event: fresh counters for everyone in the conversation. */
export const pollEventSchema = z.object({ conversationId: z.uuid(), messageId: z.uuid(), poll: pollSchema });
export type PollEvent = z.infer<typeof pollEventSchema>;

export const exportedPollSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  question: z.string(),
  createdAt: z.iso.datetime(),
});
export const exportedPollVoteSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  optionIds: z.array(z.uuid()),
});
