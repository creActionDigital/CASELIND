import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { commerceTarget } from '../shop/order-logic';
import { sellerTarget } from '../seller/routing';
import { socialTarget } from '../social/routing';
import { walletTarget } from '../wallet/routing';
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
      const open = (data: unknown) => {
        const id = (data as { conversationId?: unknown } | null)?.conversationId;
        if (typeof id === 'string' && id) return router.push({ pathname: '/messages/[conversationId]', params: { conversationId: id } });
        // Une notification `commerce` portant `orgId` s'adresse au vendeur (nouvelle commande) : route vendeur d'abord.
        const seller = sellerTarget(data);
        if (seller) return router.push(seller);
        const commerce = commerceTarget(data);
        if (commerce) return router.push(commerce);
        if ((data as { transferId?: unknown } | null)?.transferId) return router.push(walletTarget(data));
        const social = socialTarget(data);
        if (social) router.push(social);
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
