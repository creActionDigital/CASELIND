import type { Order } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useI18n } from '../../../i18n';
import { Card, PagedList } from '../../../seller/ui';
import { fetchOrders } from '../../../shop/api';
import { formatMoney } from '../../../shop/format';
import { shopKeys } from '../../../shop/hooks';
import { StatusPill } from '../../../shop/parts';
import { spacing } from '../../../theme/tokens';
import { Text } from '../../../ui';

/** Factures et reçus : commandes de l'acheteur non annulées ; chacune ouvre son détail et son reçu. */
export default function WalletReceipts() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: [...shopKeys.orders, 'receipts'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrders(undefined, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <>
      <Stack.Screen options={{ title: t('mc.rcpt.title') }} />
      <PagedList<Order>
        query={q}
        keyExtractor={(o) => o.id}
        transform={(items) => items.filter((o) => o.status !== 'cancelled' && o.status !== 'pending')}
        header={
          <Text variant="small" muted style={styles.hint}>
            {t('mc.rcpt.hint')}
          </Text>
        }
        empty={{ icon: 'receipt-outline', title: t('mc.rcpt.empty'), body: t('mc.rcpt.emptyBody') }}
        renderItem={({ item }) => (
          <Card label={t('mc.rcpt.order', { number: item.number })} onPress={() => router.push({ pathname: '/orders/[orderId]', params: { orderId: item.id } })}>
            <Text variant="bodyStrong">{t('mc.rcpt.order', { number: item.number })}</Text>
            <Text variant="small" muted>
              {item.orgName} · {new Date(item.createdAt).toLocaleDateString(locale)}
            </Text>
            <Text>{formatMoney(item.totalMinor, item.currency, locale)}</Text>
            <StatusPill status={item.status} />
          </Card>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({ hint: { paddingHorizontal: spacing.lg, paddingTop: spacing.md } });
