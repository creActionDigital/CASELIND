import { z } from 'zod';
import { aiActionSchema } from './ai-actions.js';

/** Lot 12 : multi-provider AI assistant (CDC §22, decision Q9, ADR-022). */

export const aiProviderIdSchema = z.enum(['gemini', 'groq', 'mistral', 'openrouter', 'custom']);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

/** `true` = the provider may train on submitted data, `false` = it states it does not, `unknown` = not established. */
export const aiTrainsOnDataSchema = z.union([z.boolean(), z.literal('unknown')]);

/** One entry of the AI_MODELS catalogue (environment). */
export const aiCatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
  provider: aiProviderIdSchema,
  model: z.string().min(1).max(120),
  label: z.string().min(1).max(80),
  free: z.boolean(),
  trainsOnData: aiTrainsOnDataSchema,
  dataPolicy: z.string().min(1).max(500),
  speed: z.enum(['fast', 'balanced', 'slow']).optional(),
});
export type AiCatalogEntry = z.infer<typeof aiCatalogEntrySchema>;

/** Model sheet shown to users. */
export const aiModelCardSchema = aiCatalogEntrySchema.omit({ model: true });
export type AiModelCard = z.infer<typeof aiModelCardSchema>;

export const aiModelListSchema = z.object({
  items: z.array(aiModelCardSchema),
  /** Model used when the user has not chosen one; null when nothing is available. */
  defaultModelId: z.string().nullable(),
});
export type AiModelList = z.infer<typeof aiModelListSchema>;

export const adminAiModelSchema = aiCatalogEntrySchema.extend({
  enabled: z.boolean(),
  providerConfigured: z.boolean(),
  available: z.boolean(),
});
export type AdminAiModel = z.infer<typeof adminAiModelSchema>;
export const adminAiModelListSchema = z.object({ items: z.array(adminAiModelSchema) });
export type AdminAiModelList = z.infer<typeof adminAiModelListSchema>;

export const updateAiModelRequestSchema = z.object({ enabled: z.boolean() });
export type UpdateAiModelRequest = z.infer<typeof updateAiModelRequestSchema>;

export const aiSettingsSchema = z.object({
  modelId: z.string().nullable(),
  allowFallback: z.boolean(),
  acknowledgedDataNotice: z.boolean(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const updateAiSettingsRequestSchema = z
  .object({
    modelId: z.string().min(1).max(64).nullable().optional(),
    allowFallback: z.boolean().optional(),
    acknowledgedDataNotice: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;

export const AI_MESSAGE_MAX_CHARS = 4000;

export const createAiConversationRequestSchema = z.object({ title: z.string().trim().min(1).max(80).optional() });
export type CreateAiConversationRequest = z.infer<typeof createAiConversationRequestSchema>;

export const aiConversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;
export const aiConversationListSchema = z.object({ items: z.array(aiConversationSchema) });
export type AiConversationList = z.infer<typeof aiConversationListSchema>;

export const aiMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /** Model that produced an assistant message. */
  modelId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;
export const aiMessageListSchema = z.object({ items: z.array(aiMessageSchema) });
export type AiMessageList = z.infer<typeof aiMessageListSchema>;

export const sendAiMessageRequestSchema = z.object({ content: z.string().trim().min(1).max(AI_MESSAGE_MAX_CHARS) });
export type SendAiMessageRequest = z.infer<typeof sendAiMessageRequestSchema>;

export const sendAiMessageResultSchema = z.object({
  userMessage: aiMessageSchema,
  reply: aiMessageSchema,
  /** Model that actually answered. */
  modelId: z.string(),
  /** true when another model than the requested one answered (only if allowFallback). */
  fallbackUsed: z.boolean(),
  aiGenerated: z.literal(true),
  /** Actions the assistant proposes (never run before the user confirms); empty when none or when actions are off. */
  actions: z.array(aiActionSchema),
});
export type SendAiMessageResult = z.infer<typeof sendAiMessageResultSchema>;

export const productDescriptionRequestSchema = z.object({
  title: z.string().trim().min(2).max(120),
  facts: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
});
export type ProductDescriptionRequest = z.infer<typeof productDescriptionRequestSchema>;

export const productDescriptionResultSchema = z.object({
  description: z.string(),
  modelId: z.string(),
  fallbackUsed: z.boolean(),
  /** Always true: a draft to proofread, never published automatically. */
  aiGenerated: z.literal(true),
});
export type ProductDescriptionResult = z.infer<typeof productDescriptionResultSchema>;

export const exportedAiConversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), modelId: z.string().nullable(), createdAt: z.iso.datetime() })),
});
export type ExportedAiConversation = z.infer<typeof exportedAiConversationSchema>;
