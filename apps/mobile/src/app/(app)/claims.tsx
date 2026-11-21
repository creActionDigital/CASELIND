import type { OrderReturn, ReturnStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n, type MessageKey } from '../../i18n';
import { ReturnCard } from '../../returns/ui';
import { Chips, PagedList } from '../../seller/ui';
import { claimKeys, fetchMyClaims } from '../../shop/claims-api';
import { Button } from '../../ui';

type Tab = ReturnStatus | 'all';
const TABS: Tab[] = ['all', 'requested', 'approved', 'rejected', 'disputed', 'refunded'];

/** Centre de réclamations de l'acheteur : retours et litiges de toutes les commandes, par statut. */
export default function Claims() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const q = useInfiniteQuery({
    queryKey: claimKeys.mine(tab),
    queryFn: ({ pageParam }) => fetchMyClaims(tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <>
      <Stack.Screen options={{ title: t('mc.claims.title') }} />
      <PagedList<OrderReturn>
        query={q}
        keyExtractor={(r) => r.id}
        header={<Chips options={TABS.map((s) => ({ value: s, label: s === 'all' ? t('mc.claims.all') : t(`returns.status.${s}` as MessageKey) }))} value={tab} onChange={setTab} />}
        empty={{ icon: 'return-down-back-outline', title: t('mc.claims.empty'), body: t('mc.claims.emptyBody'), actionLabel: t('mc.claims.orders'), onAction: () => router.push('/orders') }}
        renderItem={({ item }) => (
          <ReturnCard r={item} showOrder>
            <Button variant="secondary" label={t('mc.claims.openOrder')} onPress={() => router.push({ pathname: '/orders/[orderId]', params: { orderId: item.orderId } })} />
          </ReturnCard>
        )}
      />
    </>
  );
}
