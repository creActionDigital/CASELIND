import type { OrderReturn, ReturnStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useI18n, type MessageKey } from '../../../../i18n';
import { returnKeys, fetchOrgReturns } from '../../../../returns/api';
import { ReturnCard } from '../../../../returns/ui';
import { SellerActions } from '../../../../returns/SellerActions';
import { useMembership } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Chips, Loading, PagedList } from '../../../../seller/ui';
import { EmptyState, ErrorState } from '../../../../ui';

type Tab = ReturnStatus | 'all';
const TABS: Tab[] = ['requested', 'approved', 'received', 'disputed', 'rejected', 'refunded', 'all'];

/** Retours reçus par l'organisation (`orders.manage`), un onglet par statut : accepter, refuser, reçu, remboursé (hors plateforme). */
export default function SellerReturns() {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'orders.manage');
  const [tab, setTab] = useState<Tab>('requested');
  const q = useInfiniteQuery({
    queryKey: [...returnKeys.org(orgId), tab],
    queryFn: ({ pageParam }) => fetchOrgReturns(orgId, tab === 'all' ? undefined : tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!orgId && allowed,
  });

  const title = <Stack.Screen options={{ title: t('returns.seller.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<EmptyState icon="lock-closed-outline" title={t('returns.seller.forbidden')} /></>;
  return (
    <>
      {title}
      <PagedList<OrderReturn>
        query={q}
        keyExtractor={(r) => r.id}
        header={<Chips options={TABS.map((s) => ({ value: s, label: s === 'all' ? t('returns.seller.all') : t(`returns.status.${s}` as MessageKey) }))} value={tab} onChange={setTab} />}
        empty={{ icon: 'return-down-back-outline', title: t('returns.seller.empty') }}
        renderItem={({ item }) => (
          <ReturnCard r={item} showOrder>
            <SellerActions orgId={orgId} r={item} />
          </ReturnCard>
        )}
      />
    </>
  );
}
