import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { useUnreadCount } from '../notifications/hooks';
import { fetchProfile, svcKeys } from '../services/api';
import { isCourier } from '../delivery/seller-logic';
import { useMyOrgs } from '../seller/api';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Badge, Button, Text } from '../ui';
import { SheetModal } from './SheetModal';

type Icon = ComponentProps<typeof Ionicons>['name'];
type Path = '/profile' | '/sessions' | '/security/2fa' | '/security/identifier' | '/kyc' | '/privacy' | '/language' | '/notifications' | '/notification-preferences' | '/my-reports' | '/favorites' | '/scheduled' | '/wallet/pin' | '/orders' | '/deliveries' | '/bookings' | '/rides/history' | '/provider/me' | '/seller' | '/seller/new';

/** Menu Compte : MyProfile, Sessions, Confidentialité, Langue, Déconnexion (avec confirmation). */
export function AccountMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me, signOut } = useAuth();
  const router = useRouter();
  const unread = useUnreadCount();
  // Espace vendeur : membre actif (ou invitation en attente) -> /seller ; sinon proposition de créer sa boutique.
  const orgs = useMyOrgs().data?.items;
  const sellerPath: Path = orgs && orgs.length > 0 ? '/seller' : '/seller/new';
  const provider = useQuery({ queryKey: svcKeys.profile, queryFn: fetchProfile, enabled: visible, retry: false });
  const hasShop = !!orgs?.some((m) => m.status === 'active');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    setConfirming(false);
    onClose();
  }
  function go(path: Path) {
    close();
    router.push(path);
  }

  const items: { icon: Icon; label: string; path: Path }[] = [
    { icon: 'person-outline', label: t('account.profile'), path: '/profile' },
    { icon: 'receipt-outline', label: t('orders.title'), path: '/orders' },
    { icon: 'calendar-outline', label: t('bookings.title'), path: '/bookings' },
    { icon: 'car-sport-outline', label: t('mobility.history.title'), path: '/rides/history' },
    { icon: 'construct-outline', label: provider.data ? t('services.pro.mine') : t('services.pro.become'), path: '/provider/me' },
    {
      icon: 'storefront-outline',
      label: hasShop ? t('seller.title') : orgs && orgs.length > 0 ? t('seller.invitations') : t('seller.createShop'),
      path: sellerPath,
    },
    ...(isCourier(orgs) ? [{ icon: 'bicycle-outline' as Icon, label: t('delivery.mine.title'), path: '/deliveries' as Path }] : []),
    { icon: 'notifications-outline', label: t('account.notifications'), path: '/notifications' },
    { icon: 'options-outline', label: t('account.notificationPreferences'), path: '/notification-preferences' },
    { icon: 'shield-checkmark-outline', label: t('account.privacy'), path: '/privacy' },
    { icon: 'flag-outline', label: t('report.mine.title'), path: '/my-reports' },
    { icon: 'star-outline', label: t('messagesX.fav.title'), path: '/favorites' },
    { icon: 'time-outline', label: t('messagesX.scheduled.menu'), path: '/scheduled' },
    { icon: 'language-outline', label: t('account.language'), path: '/language' },
  ];

  // Section « Sécurité » : sessions, double authentification, identifiant, PIN de paiement, vérification d'identité.
  const securityItems: { icon: Icon; label: string; path: Path }[] = [
    { icon: 'phone-portrait-outline', label: t('account.sessions'), path: '/sessions' },
    { icon: 'lock-closed-outline', label: t('security.2fa.title'), path: '/security/2fa' },
    { icon: 'swap-horizontal-outline', label: t('security.identifier.title'), path: '/security/identifier' },
    { icon: 'keypad-outline', label: t('account.paymentSecurity'), path: '/wallet/pin' },
    { icon: 'id-card-outline', label: t('kyc.title'), path: '/kyc' },
  ];

  return (
    <SheetModal visible={visible} onClose={close}>
      <View style={styles.head}>
        <Avatar name={me?.displayName ?? '?'} size={48} contentUrl={me?.avatarUrl} />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {me?.displayName}
          </Text>
          <Text variant="small" muted numberOfLines={1}>
            @{me?.handle}
          </Text>
        </View>
      </View>
      {confirming ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('signOut.confirmTitle')}
          </Text>
          <Text muted>{t('signOut.confirmBody')}</Text>
          <Button
            variant="danger"
            label={t('account.signOut')}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await signOut();
            }}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setConfirming(false)} />
        </View>
      ) : (
        <View>
          {items.map((it) => (
            <Pressable
              key={it.path}
              accessibilityRole="button"
              accessibilityLabel={it.path === '/notifications' && unread > 0 ? `${it.label}, ${t('notifications.unreadCount', { n: unread })}` : it.label}
              onPress={() => go(it.path)}
              style={styles.item}
            >
              <Ionicons name={it.icon} size={22} color={colors.primary} />
              <Text style={{ flex: 1 }}>{it.label}</Text>
              {it.path === '/notifications' && unread > 0 ? <Badge label={unread > 99 ? '99+' : String(unread)} /> : null}
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
          <Text variant="small" muted accessibilityRole="header" style={{ marginTop: spacing.md }}>
            {t('security.menu.section')}
          </Text>
          {securityItems.map((it) => (
            <Pressable key={it.path} accessibilityRole="button" accessibilityLabel={it.label} onPress={() => go(it.path)} style={styles.item}>
              <Ionicons name={it.icon} size={22} color={colors.primary} />
              <Text style={{ flex: 1 }}>{it.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('account.signOut')}
            onPress={() => setConfirming(true)}
            style={styles.item}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.danger} />
            <Text color={colors.danger} style={{ flex: 1 }}>
              {t('account.signOut')}
            </Text>
          </Pressable>
        </View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  item: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
