import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { useUnreadCount } from '../notifications/hooks';
import { useCartCount } from '../shop/hooks';
import { brandGradient, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Badge, Wordmark } from '../ui';
import { AccountMenu } from './AccountMenu';

type Icon = ComponentProps<typeof Ionicons>['name'];

/**
 * En-tête global des onglets : logo · recherche · assistant IA · wallet ($, sans montant) · panier · compte.
 * Le montant du wallet n'apparaît jamais ici : seulement dans l'écran Wallet (demande du propriétaire).
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
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.background }]}>
      <View style={styles.row}>
        <View style={styles.logo}>
          <Wordmark size={15} />
        </View>
        <HeaderIcon icon="search-outline" label={t('header.search')} onPress={() => router.push('/search')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ai.title')}
          onPress={() => router.push('/ai')}
          style={({ pressed }) => [styles.circle, { opacity: pressed ? 0.8 : 1 }]}
        >
          <LinearGradient colors={brandGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientFill}>
            <Ionicons name="sparkles" size={18} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
        <HeaderIcon icon="logo-usd" label={t('wallet.title')} onPress={() => router.push('/wallet')} />
        <HeaderIcon
          icon="bag-handle-outline"
          label={t('header.cart', { n: cartCount })}
          onPress={() => router.push('/cart')}
          badge={cartCount > 0 ? <Badge label={cartCount > 99 ? '99+' : String(cartCount)} /> : undefined}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `${t('header.account')}, ${t('notifications.unreadCount', { n: unread })}` : t('header.account')}
          onPress={() => setMenuOpen(true)}
          style={styles.circle}
        >
          <Avatar name={me?.displayName ?? '?'} size={36} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Badge label={unread > 99 ? '99+' : String(unread)} tone="accent" />
            </View>
          ) : null}
        </Pressable>
      </View>
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
  gradientFill: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4 },
});
