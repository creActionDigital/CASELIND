import { notificationListSchema, unreadCountSchema } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';
import { qk } from '../messaging/keys';

export const fetchNotifications = (cursor?: string, category?: string) =>
  api.request('/notifications', { query: { limit: 20, cursor, category }, schema: notificationListSchema });

/** Compteur de non-lus (rafraîchi par `notification.new` via le socket). */
export function useUnreadCount(): number {
  const { status } = useAuth();
  const q = useQuery({
    queryKey: qk.unreadCount,
    queryFn: () => api.request('/notifications/unread-count', { schema: unreadCountSchema }),
    enabled: status === 'signedIn',
  });
  return q.data?.count ?? 0;
}
