import { z } from 'zod';
import { orgKindSchema } from './orgs.js';

/**
 * Assistant actions (CDC section 22): the model may only PROPOSE actions from this whitelist; the user confirms
 * each one, and the server runs it with the user's own rights. Anything else the model writes is ignored.
 */
export const AI_ACTION_TOOLS = ['search_products', 'search_places', 'summarize_text', 'prepare_cart', 'open_screen'] as const;
export const aiActionToolSchema = z.enum(AI_ACTION_TOOLS);
export type AiActionTool = z.infer<typeof aiActionToolSchema>;

/** Screens the assistant may propose to open (app paths). */
export const AI_SCREEN_PATHS = ['/cart', '/orders', '/search', '/favorites', '/wallet', '/notifications', '/consents', '/scheduled', '/loyalty', '/ai'] as const;
export const aiScreenPathSchema = z.enum(AI_SCREEN_PATHS);

export const AI_ACTION_TTL_MINUTES = 10;
export const AI_ACTIONS_MAX_PER_REPLY = 3;
export const AI_SUMMARY_TEXT_MAX = 4000;

const money = z.number().int().min(0).max(1_000_000_000_000);

/** Strict argument schemas, one per tool: an unknown key makes the proposal invalid. */
export const aiActionArgsSchemas = {
  search_products: z.object({ q: z.string().trim().min(1).max(100), maxPriceMinor: money.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict(),
  search_places: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), kind: orgKindSchema.optional(), q: z.string().trim().min(1).max(100).optional() }).strict(),
  summarize_text: z.object({ text: z.string().trim().min(1).max(AI_SUMMARY_TEXT_MAX) }).strict(),
  /** What the model proposes: product wishes. The server turns them into concrete variants (see `aiCartLineSchema`). */
  prepare_cart: z.object({ items: z.array(z.object({ q: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(3) }).strict(),
  open_screen: z.object({ path: aiScreenPathSchema }).strict(),
} as const;

/** A resolved cart line, stored in the action once the server found the variant. */
export const aiCartLineSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(20),
  title: z.string(),
  priceMinor: z.number().int(),
  currency: z.string(),
});
export type AiCartLine = z.infer<typeof aiCartLineSchema>;

export const aiActionStatusSchema = z.enum(['proposed', 'confirmed', 'dismissed', 'expired', 'failed']);
export type AiActionStatus = z.infer<typeof aiActionStatusSchema>;

export const aiActionSchema = z.object({
  id: z.uuid(),
  tool: aiActionToolSchema,
  args: z.record(z.string(), z.unknown()),
  label: z.string().min(1).max(120),
  status: aiActionStatusSchema,
  expiresAt: z.iso.datetime(),
});
export type AiAction = z.infer<typeof aiActionSchema>;
export const aiActionListSchema = z.object({ items: z.array(aiActionSchema) });
export type AiActionList = z.infer<typeof aiActionListSchema>;

export const aiActionResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('products'), items: z.array(z.object({ id: z.uuid(), title: z.string(), minPriceMinor: z.number().int(), currency: z.string(), orgName: z.string() })) }),
  z.object({ kind: z.literal('places'), items: z.array(z.object({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string().nullable(), distanceKm: z.number() })) }),
  z.object({ kind: z.literal('summary'), text: z.string() }),
  z.object({ kind: z.literal('cart'), lines: z.array(aiCartLineSchema) }),
  z.object({ kind: z.literal('open_screen'), path: aiScreenPathSchema }),
]);
export type AiActionResult = z.infer<typeof aiActionResultSchema>;

export const aiActionOutcomeSchema = z.object({ action: aiActionSchema, result: aiActionResultSchema.nullable() });
export type AiActionOutcome = z.infer<typeof aiActionOutcomeSchema>;

/** Journal line: tool, status and date only, never the arguments. */
export const exportedAiActionLogSchema = z.object({ tool: z.string(), status: z.string(), createdAt: z.iso.datetime() });
export type ExportedAiActionLog = z.infer<typeof exportedAiActionLogSchema>;
