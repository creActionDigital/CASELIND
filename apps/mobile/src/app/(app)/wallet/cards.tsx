import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { formatMoney } from '../../../shop/format';
import { brandColor, radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Screen, Text } from '../../../ui';
import { useWallet } from '../../../wallet/hooks';
import { useWalletPrefs } from '../../../wallet/prefs';
import { SandboxBanner } from '../../../wallet/ui';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

/** Cartes virtuelles, d'après la maquette « card » : carte, solde, trois actions, transactions récentes. Pas d'émetteur : numéro masqué, rien d'inventé. */
export default function WalletCards() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { currency } = useWalletPrefs();
  const wallet = useWallet();
  const balance = wallet.data?.balances.find((b) => b.currency === currency)?.balanceMinor ?? 0;

  const action = (icon: Icon, label: string, href: '/wallet/topup' | '/wallet/send' | '/wallet/manage') => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.actionIcon, { backgroundColor: colors.surface }]}>
        <Ionicons name={icon} size={22} color={colors.text} />
      </View>
      <Text variant="small">{label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wallet.cards.title') }} />
      <View style={styles.wrap}>
        <SandboxBanner />
        <View style={[styles.card, { backgroundColor: brandColor }]} accessibilityLabel={t('wallet.cards.virtual')}>
          <Text variant="bodyStrong" style={styles.onCard}>
            CASELIND
          </Text>
          <Text style={[styles.onCard, styles.digits]}>•••• •••• •••• ••••</Text>
          <Text variant="small" style={styles.onCard}>
            {t('wallet.cards.virtual')} · {t('wallet.manage.soonHint')}
          </Text>
        </View>
        <Text variant="title" style={{ textAlign: 'center' }}>
          {formatMoney(balance, currency, locale)}
        </Text>
        <View style={styles.actions}>
          {action('add', t('wallet.action.topup'), '/wallet/topup')}
          {action('arrow-up', t('wallet.action.send'), '/wallet/send')}
          {action('settings-outline', t('wallet.manage.title'), '/wallet/manage')}
        </View>
        <View style={[styles.recent, { backgroundColor: colors.surface }]}>
          <Text variant="bodyStrong">{t('wallet.cards.recent')}</Text>
          <Text muted>{t('wallet.cards.noneRecent')}</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  card: { height: 190, borderRadius: radius.xl, padding: spacing.lg, justifyContent: 'space-between' },
  onCard: { color: '#FFFFFF' },
  digits: { fontSize: 20, letterSpacing: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: spacing.xs, minHeight: TOUCH },
  actionIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  recent: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
});
