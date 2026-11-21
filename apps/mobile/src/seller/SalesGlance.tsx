import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { formatMoney } from '../shop/format';
import { spacing } from '../theme/tokens';
import { ErrorState, Text } from '../ui';
import { ChipRow, Chip, FadeInView, ProgressBar, SectionHeader, Skeleton, StatCard } from '../ui/premium';
import { fetchSalesSummary } from './api';

/** Chiffres clés du tableau de bord vendeur (7 ou 30 jours) : chiffre d'affaires, commandes, panier moyen, meilleures ventes en barres. */
export function SalesGlance({ orgId }: { orgId: string }) {
  const { t, locale } = useI18n();
  const [days, setDays] = useState<7 | 30>(7);
  const q = useQuery({ queryKey: ['sales-glance', orgId, days], queryFn: () => fetchSalesSummary(orgId, days), staleTime: 60_000 });
  const cur = q.data?.currencies[0];
  const top = cur?.topProducts.slice(0, 5) ?? [];
  const max = Math.max(1, ...top.map((p) => p.revenueMinor));
  return (
    <View style={styles.col}>
      <SectionHeader title={t('mc.dash.title')} />
      <ChipRow>
        {([7, 30] as const).map((d) => (
          <Chip key={d} label={t('mc.dash.days', { n: d })} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </ChipRow>
      {q.isPending ? (
        <View style={styles.cards}>
          <Skeleton height={84} rounded={20} style={styles.card} />
          <Skeleton height={84} rounded={20} style={styles.card} />
        </View>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !cur ? (
        <Text muted>{t('mc.dash.empty')}</Text>
      ) : (
        <FadeInView style={styles.col}>
          <View style={styles.cards}>
            <View style={styles.card}>
              <StatCard label={t('mc.dash.revenue', { currency: cur.currency })} value={formatMoney(cur.revenueMinor, cur.currency, locale)} />
            </View>
            <View style={styles.card}>
              <StatCard label={t('mc.dash.orders')} value={String(cur.orders)} />
            </View>
            <View style={styles.card}>
              <StatCard label={t('mc.dash.basket')} value={formatMoney(cur.averageBasketMinor, cur.currency, locale)} />
            </View>
          </View>
          {top.length > 0 ? (
            <View style={styles.col}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {t('mc.dash.top')}
              </Text>
              {top.map((p) => (
                <View key={p.productId} style={styles.bar}>
                  <Text variant="small" numberOfLines={1}>
                    {p.title} · {p.quantity}
                  </Text>
                  <ProgressBar value={p.revenueMinor / max} label={`${p.title}: ${formatMoney(p.revenueMinor, cur.currency, locale)}`} />
                </View>
              ))}
            </View>
          ) : null}
        </FadeInView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.sm },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { flexGrow: 1, flexBasis: 140 },
  bar: { gap: 4 },
});
