import { callListSchema, callSchema, liveListSchema, liveMessageListSchema, liveMessageSchema, liveSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const clKeys = {
  lives: ['lives'] as const,
  live: (id: string) => ['lives', id] as const,
  liveMessages: (id: string) => ['lives', id, 'messages'] as const,
  calls: ['calls'] as const,
};

export const fetchLives = () => api.request('/lives', { schema: liveListSchema });
export const fetchLive = (id: string) => api.request(`/lives/${id}`, { schema: liveSchema });
export const startLive = (title: string) => api.request('/lives', { method: 'POST', body: { title }, schema: liveSchema });
export const joinLive = (id: string) => api.request(`/lives/${id}/join`, { method: 'POST', schema: liveSchema });
export const leaveLive = (id: string) => api.request(`/lives/${id}/leave`, { method: 'POST' });
export const endLive = (id: string) => api.request(`/lives/${id}/end`, { method: 'POST', schema: liveSchema });
export const fetchLiveMessages = (id: string) => api.request(`/lives/${id}/messages`, { schema: liveMessageListSchema });
export const sendLiveMessage = (id: string, body: string) => api.request(`/lives/${id}/messages`, { method: 'POST', body: { body }, schema: liveMessageSchema });

export const fetchCalls = () => api.request('/me/calls', { schema: callListSchema });
export const startCall = (conversationId: string, kind: 'audio' | 'video') => api.request(`/conversations/${conversationId}/calls`, { method: 'POST', body: { kind }, schema: callSchema });
export const callAction = (id: string, action: 'accept' | 'decline' | 'end') => api.request(`/calls/${id}/${action}`, { method: 'POST', schema: callSchema });
