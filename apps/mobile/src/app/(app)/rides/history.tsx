import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchMyRides, rideKeys } from '../../../mobility/api';
import { fareLine } from '../../../mobility/logic';
import { Card, Chips, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, EmptyState, ErrorState, Text } from '../../../ui';

type Scope = 'all' | 'active' | 'done';

/** Historique des courses (passager et chauffeur) ; une course terminée ouvre son reçu. */
export default function RideHistory() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('all');
  const q = useQuery({ queryKey: rideKeys.mine(scope), queryFn: () => fetchMyRides(scope), retry: false });
  const header = (
    <Chips<Scope>
      options={[
        { value: 'all', label: t('mobility.history.all') },
        { value: 'active', label: t('mobility.history.active') },
        { value: 'done', label: t('mobility.history.done') },
      ]}
      value={scope}
      onChange={setScope}
    />
  );
  let body;
  if (q.isPending) body = <Loading />;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (q.data.items.length === 0) body = <EmptyState icon="car-outline" title={t('mobility.history.emptyTitle')} body={t('mobility.history.emptyBody')} />;
  else
    body = (
      <FlatList
        data={q.data.items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        refreshing={q.isRefetching}
        onRefresh={() => q.refetch()}
        renderItem={({ item: r }) => (
          <Card
            label={`${r.pickup.label} → ${r.dropoff.label}, ${t(`mobility.status.${r.status}` as MessageKey)}`}
            onPress={() => router.push({ pathname: '/rides/[rideId]', params: { rideId: r.id } })}
            style={{ gap: spacing.xs }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {r.pickup.label} → {r.dropoff.label}
              </Text>
              <Badge tone={r.status === 'completed' ? 'primary' : 'neutral'} label={t(`mobility.status.${r.status}` as MessageKey)} />
            </View>
            <Text variant="small" muted>
              {new Date(r.completedAt ?? r.scheduledAt ?? r.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {t(r.role === 'driver' ? 'mobility.history.asDriver' : 'mobility.history.asRider')} · {fareLine(r, locale).text}
            </Text>
          </Card>
        )}
      />
    );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('mobility.history.title') }} />
      {header}
      {body}
    </View>
  );
}
