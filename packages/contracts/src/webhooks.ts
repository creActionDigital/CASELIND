import { z } from 'zod';

/** Webhooks sortants d'une organisation : liste blanche d'evenements, 5 abonnements au plus par organisation. */
export const WEBHOOK_EVENTS = ['order.created', 'order.status_changed', 'pos.sale_created', 'pos.sale_voided', 'org.question_asked'] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export const WEBHOOKS_PER_ORG = 5;
export const WEBHOOK_URL_MAX = 500;

const eventsSchema = z
  .array(webhookEventSchema)
  .min(1)
  .max(10)
  .refine((a) => new Set(a).size === a.length, 'duplicate events');

/** L'URL est validee par le serveur (https, pas d'adresse privee : 400 `reason: url_*`). */
export const createWebhookRequestSchema = z.object({ url: z.string().trim().min(1).max(WEBHOOK_URL_MAX), events: eventsSchema });
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

export const updateWebhookRequestSchema = z
  .object({ url: z.string().trim().min(1).max(WEBHOOK_URL_MAX), events: eventsSchema, active: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;

export const webhookSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  events: z.array(webhookEventSchema),
  active: z.boolean(),
  /** Echecs consecutifs ; 10 desactivent l'abonnement. */
  failureCount: z.number().int(),
  lastStatus: z.number().int().nullable(),
  lastDeliveryAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Webhook = z.infer<typeof webhookSchema>;

/** Le secret n'est renvoye qu'a la creation et a la rotation, jamais ensuite. */
export const webhookWithSecretSchema = webhookSchema.extend({ secret: z.string() });
export type WebhookWithSecret = z.infer<typeof webhookWithSecretSchema>;

export const webhookListSchema = z.object({ items: z.array(webhookSchema) });
export type WebhookList = z.infer<typeof webhookListSchema>;

export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  event: z.string(),
  status: z.enum(['pending', 'delivered', 'failed']),
  httpStatus: z.number().int().nullable(),
  attempt: z.number().int(),
  /** blocked | timeout | network | http | null. Jamais le corps de la reponse. */
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  nextAttemptAt: z.string().nullable(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookDeliveryListSchema = z.object({ items: z.array(webhookDeliverySchema) });
export type WebhookDeliveryList = z.infer<typeof webhookDeliveryListSchema>;
