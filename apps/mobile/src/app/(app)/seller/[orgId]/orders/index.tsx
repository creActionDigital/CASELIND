import type { Order, OrderStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { fetchOrders, sk } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { sortNewestFirst } from '../../../../../seller/order-flow';
import { Card, Chips, OrderStatusBadge, PagedList } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { Text } from '../../../../../ui';

type Tab = OrderStatus | 'all';
const TABS: Tab[] = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'all'];

/** Commandes reçues, un onglet par statut (« En attente » d'abord, nouvelles en tête). */
export default function SellerOrders() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [tab, setTab] = useState<Tab>('pending');

  const q = useInfiniteQuery({
    queryKey: [...sk.orders(orgId), tab],
    queryFn: ({ pageParam }) => fetchOrders(orgId, tab === 'all' ? undefined : tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  return (
    <>
      <Stack.Screen options={{ title: t('seller.orders') }} />
      <PagedList<Order>
        query={q}
        keyExtractor={(o) => o.id}
        transform={sortNewestFirst}
        header={
          <Chips
            options={TABS.map((s) => ({ value: s, label: s === 'all' ? t('seller.filter.all') : t(`seller.status.${s}` as MessageKey) }))}
            value={tab}
            onChange={setTab}
          />
        }
        empty={{ icon: 'receipt-outline', title: t('seller.orders.emptyTitle'), body: t('seller.orders.emptyBody') }}
        renderItem={({ item: o }) => (
          <Card
            label={`${o.number}`}
            onPress={() => router.push({ pathname: '/seller/[orgId]/orders/[orderId]', params: { orgId, orderId: o.id } })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {o.number}
              </Text>
              <OrderStatusBadge status={o.status} />
            </View>
            <Text variant="small">
              {o.address?.name ?? t('seller.order.erasedBuyer')} · {t('seller.order.itemsCount', { n: o.items.reduce((n, i) => n + i.quantity, 0) })}
            </Text>
            <Text variant="small" muted>
              {formatMinor(o.totalMinor, o.currency, locale)} · {new Date(o.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Card>
        )}
      />
    </>
  );
}
