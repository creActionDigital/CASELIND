import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, View } from 'react-native';
import { fetchBilling } from '../../../ads/api';
import { useI18n } from '../../../i18n';
import { Card, Loading } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

/** Facturation publicitaire : budgets débités et remboursements du budget non dépensé (portefeuille de test). */
export default function AdBilling() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['ad-billing'], queryFn: fetchBilling });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('mon.ads.billing.title') }} />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <FlatList
          data={q.data.items}
          keyExtractor={(b) => `${b.campaignId}-${b.kind}`}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ListHeaderComponent={<SandboxBanner />}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title={t('mon.ads.billing.empty')} />}
          refreshing={q.isRefetching}
          onRefresh={() => q.refetch()}
          renderItem={({ item: b }) => (
            <Card style={{ gap: 2 }}>
              <Text style={{ fontWeight: '700' }}>{b.name}</Text>
              <Text color={b.kind === 'refund' ? colors.success : undefined}>
                {t(b.kind === 'refund' ? 'mon.ads.billing.refund' : 'mon.ads.billing.charge')} : {b.kind === 'refund' ? '+' : '-'}
                {formatMoney(b.amountMinor, b.currency, locale)}
              </Text>
              <Text variant="small" muted>
                {new Date(b.createdAt).toLocaleString(locale)}
              </Text>
            </Card>
          )}
        />
      ) : null}
    </View>
  );
}
