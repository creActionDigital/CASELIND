import {
  type CreateWebhookRequest,
  type UpdateWebhookRequest,
  webhookDeliveryListSchema,
  webhookDeliverySchema,
  webhookListSchema,
  webhookSchema,
  webhookWithSecretSchema,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const webhookKeys = {
  list: (orgId: string) => ['org-webhooks', orgId] as const,
  deliveries: (orgId: string, id: string) => ['org-webhooks', orgId, id, 'deliveries'] as const,
};

export const fetchWebhooks = (orgId: string) => api.request(`/orgs/${orgId}/webhooks`, { schema: webhookListSchema });
export const createWebhook = (orgId: string, body: CreateWebhookRequest) => api.request(`/orgs/${orgId}/webhooks`, { method: 'POST', body, schema: webhookWithSecretSchema });
export const patchWebhook = (orgId: string, id: string, body: UpdateWebhookRequest) => api.request(`/orgs/${orgId}/webhooks/${id}`, { method: 'PATCH', body, schema: webhookSchema });
export const deleteWebhook = (orgId: string, id: string) => api.request(`/orgs/${orgId}/webhooks/${id}`, { method: 'DELETE' });
export const rotateWebhookSecret = (orgId: string, id: string) => api.request(`/orgs/${orgId}/webhooks/${id}/rotate-secret`, { method: 'POST', schema: webhookWithSecretSchema });
export const testWebhook = (orgId: string, id: string) => api.request(`/orgs/${orgId}/webhooks/${id}/test`, { method: 'POST', schema: webhookDeliverySchema });
/** Le serveur renvoie les 50 derniers ; l'écran n'en montre que 10. */
export const fetchWebhookDeliveries = (orgId: string, id: string) => api.request(`/orgs/${orgId}/webhooks/${id}/deliveries`, { schema: webhookDeliveryListSchema });
