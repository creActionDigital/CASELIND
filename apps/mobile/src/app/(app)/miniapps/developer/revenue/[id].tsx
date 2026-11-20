import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Platform, Share, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { fetchRevenue, pKeys } from '../../../../../miniapps/platform-api';
import { Card, Loading } from '../../../../../seller/ui';
import { formatMoney } from '../../../../../shop/format';
import { spacing } from '../../../../../theme/tokens';
import { Button, ErrorState, Screen, Text } from '../../../../../ui';

/** Relevés mensuels indicatifs : brut des paiements confirmés, part de la plateforme, part du développeur. Aucun versement réel. */
export default function DeveloperRevenue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: pKeys.revenue(id), queryFn: () => fetchRevenue(id) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const csv = () => {
    const lines = ['period,currency,gross_minor,platform_minor,developer_minor,share_bps,payments_count,status', ...q.data.items.map((i) => [i.period, i.currency, i.grossMinor, i.platformMinor, i.developerMinor, i.shareBps, i.paymentsCount, i.status].join(','))];
    void Share.share({ message: [...lines, `# ${q.data.disclaimer}`].join('\n') });
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mp.dev.revenue.title') }} />
      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="small">{t('mp.dev.revenue.indicative')}</Text>
          <Text variant="caption" muted>{t('mp.dev.revenue.share', { pct: (q.data.revenueShareBps / 100).toFixed(2) })}</Text>
        </Card>
        {q.data.items.length === 0 ? <Text muted>{t('mp.dev.revenue.empty')}</Text> : null}
        {q.data.items.map((i) => (
          <Card key={`${i.period}-${i.currency}`}>
            <Text variant="bodyStrong">{i.period.slice(0, 7)} · {i.currency}{i.status === 'open' ? ` · ${t('mp.dev.revenue.open2')}` : ''}</Text>
            <Text variant="small">{t('mp.dev.revenue.gross', { amount: formatMoney(i.grossMinor, i.currency, locale), n: i.paymentsCount })}</Text>
            <Text variant="small">{t('mp.dev.revenue.platform', { amount: formatMoney(i.platformMinor, i.currency, locale) })}</Text>
            <Text variant="small">{t('mp.dev.revenue.developer', { amount: formatMoney(i.developerMinor, i.currency, locale) })}</Text>
          </Card>
        ))}
        {q.data.items.length > 0 && Platform.OS !== 'web' ? <Button variant="secondary" label={t('mp.dev.revenue.csv')} onPress={csv} /> : null}
      </View>
    </Screen>
  );
}
