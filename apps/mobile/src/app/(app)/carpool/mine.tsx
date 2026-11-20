import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { extraKeys, fetchMyCarpool } from '../../../mobility/extra/api';
import { formatWhen } from '../../../mobility/extra/ui';
import { Card, Chips, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

type Role = 'driver' | 'passenger';

/** Mes trajets : ceux que je conduis et ceux que j’ai réservés. */
export default function MyCarpool() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [role, setRole] = useState<Role>('driver');
  const q = useQuery({ queryKey: extraKeys.carpoolMine(role), queryFn: () => fetchMyCarpool(role), retry: false });
  const title = <Stack.Screen options={{ title: t('carpool.mine.title') }} />;
  return (
    <Screen>
      {title}
      <Text variant="title" accessibilityRole="header">
        {t('carpool.mine.title')}
      </Text>
      <Chips<Role>
        scroll={false}
        options={[
          { value: 'driver', label: t('carpool.mine.driver') },
          { value: 'passenger', label: t('carpool.mine.passenger') },
        ]}
        value={role}
        onChange={setRole}
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon="car-outline" title={t('carpool.mine.empty')} />
      ) : (
        q.data.items.map((trip) => (
          <Card key={trip.id} label={`${trip.origin.label} → ${trip.destination.label}`} onPress={() => router.push(`/carpool/${trip.id}` as never)} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {trip.origin.label} → {trip.destination.label}
              </Text>
              <Badge tone="accent" label={t(`carpool.status.${trip.status}` as MessageKey)} />
            </View>
            <Text variant="small" muted>
              {formatWhen(trip.departsAt, locale)} · {t('carpool.seatsLeft', { n: trip.seatsFree })}
              {role === 'driver' && trip.bookings.some((b) => b.status === 'requested') ? ` · ${t('carpool.pending')}` : ''}
            </Text>
          </Card>
        ))
      )}
      <Button variant="secondary" label={t('carpool.link.new')} onPress={() => router.push('/carpool/new' as never)} />
    </Screen>
  );
}
