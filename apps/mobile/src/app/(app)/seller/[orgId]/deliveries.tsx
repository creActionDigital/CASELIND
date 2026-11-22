import type { DeliveryStatus, DeliveryView } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { fetchOrgDeliveries, setOrgDeliveryStatus } from '../../../../delivery/api';
import { deliveryErrorMessage } from '../../../../delivery/errors';
import { useI18n, type MessageKey } from '../../../../i18n';
import { Card, Chips, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Text, TextField } from '../../../../ui';

const FILTERS = ['all', 'pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'] as const;
type Filter = (typeof FILTERS)[number];

/** Livraisons de l'organisation : liste filtrée par statut, abandon (échec avec motif) et retour d'une livraison échouée. */
export default function OrgDeliveries() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [target, setTarget] = useState<{ id: string; status: 'failed' | 'returned' } | null>(null);
  const [reason, setReason] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['delivery', 'org-list', orgId, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrgDeliveries(orgId, filter === 'all' ? undefined : (filter as DeliveryStatus), pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const change = useMutation({
    mutationFn: () => setOrgDeliveryStatus(orgId, target!.id, target!.status, reason.trim()),
    onSuccess: () => {
      setTarget(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['delivery', 'org-list', orgId] });
    },
  });
  const items: DeliveryView[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Stack.Screen options={{ title: t('odel.title') }} />
      <Chips options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? t('odel.all') : t(`delivery.status.${f}` as MessageKey) }))} value={filter} onChange={setFilter} />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && items.length === 0 ? <EmptyState icon="bicycle-outline" title={t('odel.empty')} /> : null}
      {items.map((d) => (
        <Card key={d.id} label={d.orderNumber} onPress={() => router.push(`/seller/${orgId}/orders/${d.orderId}` as never)}>
          <View style={{ gap: spacing.xs }}>
            <Text variant="bodyStrong">{d.orderNumber}</Text>
            <Badge tone="neutral" label={t(`delivery.status.${d.status}` as MessageKey)} />
            <Text variant="small" muted>{d.courier ? d.courier.displayName : t('odel.noCourier')}</Text>
            {d.failureReason ? <Text variant="small" muted>{d.failureReason}</Text> : null}
            {target?.id === d.id ? (
              <>
                <TextField label={t('odel.reason')} value={reason} onChangeText={setReason} maxLength={500} multiline />
                {change.isError ? <Text variant="small" accessibilityLiveRegion="polite">{deliveryErrorMessage(change.error, t, locale)}</Text> : null}
                <Button label={t('odel.confirm')} loading={change.isPending} disabled={!reason.trim()} onPress={() => change.mutate()} />
                <Button variant="ghost" label={t('common.cancel')} onPress={() => setTarget(null)} />
              </>
            ) : d.status === 'failed' ? (
              <Button variant="secondary" label={t('odel.markReturned')} onPress={() => { setReason(''); setTarget({ id: d.id, status: 'returned' }); }} />
            ) : d.status !== 'delivered' && d.status !== 'returned' ? (
              <Button variant="secondary" label={t('odel.markFailed')} onPress={() => { setReason(''); setTarget({ id: d.id, status: 'failed' }); }} />
            ) : null}
          </View>
        </Card>
      ))}
      {q.hasNextPage ? <Button variant="secondary" label={t('odel.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : null}
    </ScrollView>
  );
}
