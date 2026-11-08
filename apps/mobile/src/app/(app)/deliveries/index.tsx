import type { CourierDelivery } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { deliveryKeys, fetchMyDeliveries } from '../../../delivery/api';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { Badge, Text } from '../../../ui';

type Scope = 'active' | 'done';

/** Mes livraisons (livreur) : en cours, puis terminées. */
export default function MyDeliveries() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('active');
  const q = useInfiniteQuery({
    queryKey: deliveryKeys.mine(scope),
    queryFn: ({ pageParam }) => fetchMyDeliveries(scope, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <>
      <Stack.Screen options={{ title: t('delivery.mine.title') }} />
      <Chips<Scope>
        options={[
          { value: 'active', label: t('delivery.mine.active') },
          { value: 'done', label: t('delivery.mine.done') },
        ]}
        value={scope}
        onChange={setScope}
      />
      <PagedList<CourierDelivery>
        query={q}
        keyExtractor={(d) => d.id}
        empty={{ icon: 'bicycle-outline', title: t('delivery.mine.emptyTitle'), body: t('delivery.mine.emptyBody') }}
        renderItem={({ item: d }) => (
          <Card
            label={`${d.orderNumber}, ${d.orgName}, ${t(`delivery.status.${d.status}` as MessageKey)}`}
            onPress={() => router.push({ pathname: '/deliveries/[deliveryId]', params: { deliveryId: d.id } })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {d.orderNumber} · {d.orgName}
              </Text>
              <Badge tone={d.proofLocked ? 'accent' : 'neutral'} label={d.proofLocked ? t('delivery.locked') : t(`delivery.status.${d.status}` as MessageKey)} />
            </View>
            {d.address ? (
              <Text variant="small" muted numberOfLines={2}>
                {d.address.line1}, {d.address.city}
              </Text>
            ) : null}
            <Text variant="small" muted>
              {t('delivery.mine.toCollect', { amount: formatMoney(d.totalMinor, d.currency, locale) })} · {t('delivery.mine.items', { n: d.itemCount })}
            </Text>
          </Card>
        )}
      />
    </>
  );
}
