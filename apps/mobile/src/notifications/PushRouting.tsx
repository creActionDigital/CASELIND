import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { notificationTarget } from './targets';
import { PUSH_SUPPORTED, registerPushIfGranted } from './push';

/** Monté une fois connecté : rafraîchit le jeton push et ouvre le salon quand on touche une notification. */
export function PushRouting() {
  const router = useRouter();

  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    void registerPushIfGranted();
    let cancelled = false;
    let remove: (() => void) | undefined;
    (async () => {
      const Notifications = await import('expo-notifications');
      if (cancelled) return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      // Push : catégorie absente du payload ('' = clés d'identifiants seules) ; sans cible, on reste sur place (l'écran Notifications a le repli).
      const open = (data: unknown) => {
        const d = (data ?? {}) as { category?: unknown };
        const target = notificationTarget({ category: typeof d.category === 'string' ? d.category : '', data });
        router.push((target ?? { pathname: '/notifications' }) as never);
      };
      const last = Notifications.getLastNotificationResponse();
      if (last) open(last.notification.request.content.data);
      const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
      remove = () => sub.remove();
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);

  return null;
}
