import type { CommissionLine } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { bpsLabel } from '../../../../admin/ops2-logic';
import { fetchOrgCommissions, o2k } from '../../../../admin/ops2-api';
import { useI18n } from '../../../../i18n';
import { Card, PagedList } from '../../../../seller/ui';
import { formatMoney } from '../../../../shop/format';
import { spacing } from '../../../../theme/tokens';
import { Text } from '../../../../ui';

/** Relevé des commissions de la boutique (permission finance.view) : indicatif, aucun prélèvement réel. */
export default function SellerCommissions() {
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const query = useInfiniteQuery({
    queryKey: o2k.list('seller', orgId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrgCommissions(orgId, pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const first = query.data?.pages[0];
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: t('ops2.comm.sellerTitle') }} />
      <PagedList
        query={query}
        keyExtractor={(l: CommissionLine) => l.orderId}
        header={
          <View style={styles.head}>
            <Text muted>{t('ops2.comm.indicative')}</Text>
            {first ? <Text variant="bodyStrong">{t('ops2.comm.currentRate', { rate: bpsLabel(first.currentBps) })}</Text> : null}
            {first?.totals.map((x) => (
              <Text key={x.currency} variant="small">{t('ops2.comm.total', { currency: x.currency, orders: x.orders, gross: formatMoney(x.grossMinor, x.currency, locale), commission: formatMoney(x.commissionMinor, x.currency, locale) })}</Text>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text variant="small">{t('ops2.comm.line', { number: item.orderNumber, gross: formatMoney(item.grossMinor, item.currency, locale), rate: bpsLabel(item.bps), commission: formatMoney(item.commissionMinor, item.currency, locale) })}</Text>
          </Card>
        )}
        empty={{ icon: 'cash-outline', title: t('ops2.comm.empty') }}
        transform={(items) => items}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { padding: spacing.md, gap: spacing.xs },
  card: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
});
