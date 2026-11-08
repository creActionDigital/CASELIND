import {
  aiConversationListSchema,
  aiConversationSchema,
  aiMessageListSchema,
  aiModelListSchema,
  aiSettingsSchema,
  sendAiMessageResultSchema,
  type UpdateAiSettingsRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

/** Assistant IA (lot 12) : modèles, réglages et conversations privées de l'utilisateur. */
export const aiKeys = {
  models: ['ai', 'models'] as const,
  settings: ['ai', 'settings'] as const,
  conversations: ['ai', 'conversations'] as const,
  messages: (id: string) => ['ai', 'messages', id] as const,
};

export const fetchAiModels = () => api.request('/ai/models', { schema: aiModelListSchema });
export const fetchAiSettings = () => api.request('/me/ai-settings', { schema: aiSettingsSchema });
export const updateAiSettings = (body: UpdateAiSettingsRequest) =>
  api.request('/me/ai-settings', { method: 'PATCH', body, schema: aiSettingsSchema });

export const fetchAiConversations = () => api.request('/ai/conversations', { schema: aiConversationListSchema });
export const createAiConversation = (title?: string) =>
  api.request('/ai/conversations', { method: 'POST', body: title ? { title } : {}, schema: aiConversationSchema });
export const deleteAiConversation = (id: string) => api.request(`/ai/conversations/${id}`, { method: 'DELETE' });
export const fetchAiMessages = (id: string) =>
  api.request(`/ai/conversations/${id}/messages`, { schema: aiMessageListSchema });
export const sendAiMessage = (id: string, content: string) =>
  api.request(`/ai/conversations/${id}/messages`, { method: 'POST', body: { content }, schema: sendAiMessageResultSchema });
