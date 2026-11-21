import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';
import { useKyc } from '../../../wallet/hooks';
import { SandboxBanner } from '../../../wallet/ui';

/** Limites du wallet par devise (transfert, jour, solde), niveau actuel et suivant ; relèvement via la vérification d'identité. */
export default function WalletLimits() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const kyc = useKyc();
  const title = <Stack.Screen options={{ title: t('mc.lim.title') }} />;
  if (kyc.isPending) return <Screen>{title}<Text muted>{t('common.loading')}</Text></Screen>;
  if (kyc.isError) return <Screen>{title}<ErrorState error={kyc.error} onRetry={() => kyc.refetch()} /></Screen>;
  const k = kyc.data;
  const block = (heading: string, list: typeof k.limits) => (
    <View style={styles.col}>
      <Text variant="heading" accessibilityRole="header">
        {heading}
      </Text>
      {list.map((l) => (
        <View key={l.currency} accessible style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="bodyStrong">{l.currency}</Text>
          <Text variant="small">{t('mc.lim.single')} : {formatMoney(l.maxSingleTransferMinor, l.currency, locale)}</Text>
          <Text variant="small">{t('mc.lim.daily')} : {formatMoney(l.maxDailyOutgoingMinor, l.currency, locale)}</Text>
          <Text variant="small">{t('mc.lim.balance')} : {formatMoney(l.maxBalanceMinor, l.currency, locale)}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <Screen>
      {title}
      <View style={styles.col}>
        <SandboxBanner />
        {k.limits.length === 0 ? <EmptyState icon="speedometer-outline" title={t('mc.lim.empty')} /> : block(t('mc.lim.level', { n: k.level }), k.limits)}
        {k.nextLevelLimits && k.nextLevelLimits.length > 0 ? block(t('mc.lim.next'), k.nextLevelLimits) : null}
        <Text variant="small" muted>
          {t('mc.lim.hint')}
        </Text>
        {k.nextLevelLimits ? <Button label={t('mc.lim.raise')} onPress={() => router.push('/kyc')} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.md },
  card: { borderRadius: 20, padding: spacing.lg, gap: 2 },
});
