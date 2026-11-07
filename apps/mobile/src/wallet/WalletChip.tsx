import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { formatMoney } from '../shop/format';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Text } from '../ui';
import { useWallet, useWalletEnabled } from './hooks';
import { setWalletPrefs, useWalletPrefs } from './prefs';

/** Puce Wallet de l'en-tête : solde de la devise principale avec œil (masqué par défaut) ; « Bientôt » si le flag est coupé. */
export function WalletChip() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const enabled = useWalletEnabled();
  const prefs = useWalletPrefs();
  const wallet = useWallet();
  const live = enabled === true;
  const balance = wallet.data?.balances.find((b) => b.currency === prefs.currency)?.balanceMinor ?? (wallet.data ? 0 : null);
  const shown = prefs.hidden || balance === null ? '••••' : formatMoney(balance, prefs.currency, locale);
  const label = !live
    ? t('header.walletSoon')
    : prefs.hidden || balance === null
      ? t('wallet.chip.hidden')
      : t('wallet.chip.label', { amount: shown });
  return (
    <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push('/wallet')} style={styles.main}>
        <Text variant="caption" color={colors.text} style={{ fontWeight: '600' }}>
          {live ? shown : t('header.wallet')}
        </Text>
        {live ? null : <Badge tone="neutral" label={t('common.soon')} />}
      </Pressable>
      {live ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={prefs.hidden ? t('wallet.show') : t('wallet.hide')}
          onPress={() => setWalletPrefs({ hidden: !prefs.hidden })}
          hitSlop={8}
          style={styles.eye}
        >
          <Ionicons name={prefs.hidden ? 'eye-outline' : 'eye-off-outline'} size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, marginHorizontal: spacing.xs },
  main: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.sm, paddingRight: spacing.xs },
  eye: { minHeight: 32, paddingRight: spacing.sm, paddingLeft: spacing.xs, justifyContent: 'center' },
});
