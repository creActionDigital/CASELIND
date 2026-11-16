import { z } from 'zod';

/** Calls and lives: signalling only. The platform never stores media nor the signalling payload (lot M9). */

export const callKindSchema = z.enum(['audio', 'video']);
export const callStatusSchema = z.enum(['ringing', 'active', 'ended', 'declined', 'missed', 'cancelled']);

export const createCallRequestSchema = z.object({ kind: callKindSchema });
export type CreateCallRequest = z.infer<typeof createCallRequestSchema>;

export const callSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  callerId: z.uuid(),
  calleeId: z.uuid(),
  kind: callKindSchema,
  status: callStatusSchema,
  createdAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});
export type Call = z.infer<typeof callSchema>;
export const callListSchema = z.object({ items: z.array(callSchema) });
export type CallList = z.infer<typeof callListSchema>;

/** One WebRTC signalling message (SDP or ICE candidate as a JSON string), relayed as is and never stored. */
export const signalRequestSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice']),
  payload: z.string().min(1).max(16000),
  /** Live only: the viewer (from the host) or omitted (viewer → host). */
  to: z.uuid().optional(),
});
export type SignalRequest = z.infer<typeof signalRequestSchema>;

export const liveSchema = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  hostHandle: z.string(),
  hostName: z.string(),
  title: z.string(),
  status: z.enum(['live', 'ended']),
  viewers: z.number().int(),
  peakViewers: z.number().int(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type Live = z.infer<typeof liveSchema>;
export const liveListSchema = z.object({ items: z.array(liveSchema) });
export type LiveList = z.infer<typeof liveListSchema>;

export const startLiveRequestSchema = z.object({ title: z.string().trim().min(1).max(100) });
export type StartLiveRequest = z.infer<typeof startLiveRequestSchema>;

export const liveMessageSchema = z.object({ id: z.uuid(), userId: z.uuid(), handle: z.string(), body: z.string(), createdAt: z.iso.datetime() });
export type LiveMessage = z.infer<typeof liveMessageSchema>;
export const liveMessageListSchema = z.object({ items: z.array(liveMessageSchema) });
export type LiveMessageList = z.infer<typeof liveMessageListSchema>;
export const sendLiveMessageRequestSchema = z.object({ body: z.string().trim().min(1).max(300) });
export type SendLiveMessageRequest = z.infer<typeof sendLiveMessageRequestSchema>;
