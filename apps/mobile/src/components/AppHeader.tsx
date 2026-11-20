import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { useUnreadCount } from '../notifications/hooks';
import { useCartCount } from '../shop/hooks';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Text, Wordmark } from '../ui';
import { AccountMenu } from './AccountMenu';

type Icon = ComponentProps<typeof Ionicons>['name'];

/**
 * En-tête global des onglets : logo · notifications · wallet ($, sans montant) · panier · menu « ⋯ » (profil, assistant IA,
 * paramètres, sécurité... : voir AccountMenu), puis une case de recherche pleine largeur qui ouvre l'écran Recherche.
 * Le montant du wallet n'apparaît jamais ici : seulement dans l'écran Wallet (demande du propriétaire).
 */
export function AppHeader() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();
  const cartCount = useCartCount();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.background }]}>
      <View style={styles.row}>
        <View style={styles.logo}>
          <Wordmark size={16} />
        </View>
        <HeaderIcon
          icon="notifications-outline"
          label={unread > 0 ? `${t('account.notifications')}, ${t('notifications.unreadCount', { n: unread })}` : t('account.notifications')}
          onPress={() => router.push('/notifications')}
          badge={unread > 0 ? <Badge label={unread > 99 ? '99+' : String(unread)} tone="accent" /> : undefined}
        />
        <HeaderIcon icon="logo-usd" label={t('wallet.title')} onPress={() => router.push('/wallet')} />
        <HeaderIcon
          icon="bag-handle-outline"
          label={t('header.cart', { n: cartCount })}
          onPress={() => router.push('/cart')}
          badge={cartCount > 0 ? <Badge label={cartCount > 99 ? '99+' : String(cartCount)} /> : undefined}
        />
        <HeaderIcon icon="ellipsis-horizontal" label={t('header.account')} onPress={() => setMenuOpen(true)} />
      </View>
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={t('header.search')}
        onPress={() => router.push('/search')}
        style={({ pressed }) => [styles.search, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <Text muted>{t('search.placeholder')}</Text>
      </Pressable>
      <AccountMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

function HeaderIcon({ icon, label, onPress, badge }: { icon: Icon; label: string; onPress: () => void; badge?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.circle, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={19} color={colors.text} />
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  logo: { flex: 1 },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, marginTop: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
