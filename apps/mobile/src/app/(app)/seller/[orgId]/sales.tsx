import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchSalesSummary } from '../../../../seller/api';
import { formatMinor } from '../../../../seller/money';
import { Card, Chips, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { ErrorState, Text } from '../../../../ui';

const PERIODS = ['7', '30', '90'] as const;

/** Analyse de ventes : commandes, chiffre d'affaires (hors annulées), panier moyen et meilleurs produits, par devise. */
export default function SellerSales() {
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [days, setDays] = useState<string>('30');
  const q = useQuery({ queryKey: ['seller', orgId, 'sales', days], queryFn: () => fetchSalesSummary(orgId, Number(days)) });
  return (
    <>
      <Stack.Screen options={{ title: t('sales.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Chips options={PERIODS.map((d) => ({ value: d, label: t('sales.days', { n: Number(d) }) }))} value={days} onChange={setDays} scroll={false} />
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.currencies.length === 0 ? <Text muted>{t('sales.empty')}</Text> : null}
        {q.data?.currencies.map((c) => (
          <Card key={c.currency}>
            <Text variant="heading">{c.currency}</Text>
            <Line label={t('sales.revenue')} value={formatMinor(c.revenueMinor, c.currency, locale)} />
            <Line label={t('sales.orders')} value={String(c.orders)} />
            <Line label={t('sales.cancelled')} value={String(c.cancelled)} />
            <Line label={t('sales.basket')} value={formatMinor(c.averageBasketMinor, c.currency, locale)} />
            {c.topProducts.length > 0 ? <Text variant="bodyStrong">{t('sales.top')}</Text> : null}
            {c.topProducts.map((p) => (
              <Line key={p.productId} label={p.title} value={t('sales.qty', { n: p.quantity })} />
            ))}
          </Card>
        ))}
        <Text variant="small" muted>
          {t('sales.note')}
        </Text>
      </ScrollView>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}
