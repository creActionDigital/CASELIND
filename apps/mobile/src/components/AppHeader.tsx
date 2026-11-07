import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { useUnreadCount } from '../notifications/hooks';
import { useCartCount } from '../shop/hooks';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Badge, IconButton, Text, Wordmark } from '../ui';
import { AccountMenu } from './AccountMenu';

/**
 * En-tête global des onglets : logo · recherche · puce Wallet · panier · menu Compte.
 * Wallet : aucun solde n'est affiché tant que le backend ne le fournit pas (état « bientôt »).
 */
export function AppHeader() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();
  const cartCount = useCartCount();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: colors.tabBar, borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        <View style={styles.logo}>
          <Wordmark size={17} />
        </View>
        <IconButton icon="search-outline" label={t('header.search')} onPress={() => router.push('/search')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('header.walletSoon')}
          onPress={() => router.push('/wallet')}
          style={({ pressed }) => [styles.chip, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text variant="caption" color={colors.text} style={{ fontWeight: '600' }}>
            {t('header.wallet')}
          </Text>
          <Badge tone="neutral" label={t('common.soon')} />
        </Pressable>
        <IconButton
          icon="cart-outline"
          label={t('header.cart', { n: cartCount })}
          onPress={() => router.push('/cart')}
          badge={cartCount > 0 ? <Badge label={cartCount > 99 ? '99+' : String(cartCount)} /> : undefined}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `${t('header.account')}, ${t('notifications.unreadCount', { n: unread })}` : t('header.account')}
          onPress={() => setMenuOpen(true)}
          style={styles.avatar}
        >
          <Avatar name={me?.displayName ?? '?'} size={34} />
          {unread > 0 ? (
            <View style={styles.unread}>
              <Badge label={unread > 99 ? '99+' : String(unread)} tone="accent" />
            </View>
          ) : null}
        </Pressable>
      </View>
      <AccountMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH + 8 },
  logo: { flex: 1, paddingLeft: spacing.xs },
  chip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    marginHorizontal: spacing.xs,
  },
  unread: { position: 'absolute', top: 0, right: 0 },
  avatar: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
