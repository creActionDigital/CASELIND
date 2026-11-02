export const qk = {
  conversations: (archived: boolean) => ['conversations', archived] as const,
  conversationsAll: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  members: (id: string) => ['members', id] as const,
  receipts: (id: string) => ['receipts', id] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['notifications-unread'] as const,
  notificationPrefs: ['notification-prefs'] as const,
};
