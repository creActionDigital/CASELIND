import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { fetchSharedRide } from '../../../../mobility/api';
import { isLiveRide } from '../../../../mobility/logic';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { Card, Loading, SectionTitle } from '../../../../seller/ui';
import { Badge, ErrorState, Screen, Text } from '../../../../ui';

/** Trajet partagé par un proche : lecture seule ; se met à jour toutes les 10 s tant que la course est active. */
export default function SharedRide() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['shared-ride', token],
    queryFn: () => fetchSharedRide(token),
    enabled: !!token,
    retry: false,
    refetchInterval: (query) => (query.state.data && isLiveRide(query.state.data.status) ? 10_000 : false),
  });
  const gone = q.error instanceof ApiRequestError && (q.error.status === 404 || q.error.status === 410);
  const r = q.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.shared.title') }} />
      {q.isPending ? <Loading /> : gone ? <Text accessibilityLiveRegion="polite">{t('mobility.shared.gone')}</Text> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : r ? (
        <View style={{ gap: 12 }}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Badge tone="primary" label={t(`mobility.status.${r.status}` as MessageKey)} />
              <Badge tone="neutral" label={t(`mobility.vehicle.${r.vehicle}` as MessageKey)} />
            </View>
          </Card>
          <SectionTitle>{t('mobility.ride.route')}</SectionTitle>
          <Card>
            <Text variant="small" muted>{t('mobility.shared.from')}</Text>
            <Text variant="bodyStrong">{r.pickupLabel}</Text>
            <Text variant="small" muted>{t('mobility.shared.to')}</Text>
            <Text variant="bodyStrong">{r.dropoffLabel}</Text>
          </Card>
          {r.driver ? (
            <>
              <SectionTitle>{t('mobility.ride.driver')}</SectionTitle>
              <Card>
                <Text variant="bodyStrong">{r.driver.displayName}</Text>
                <Text variant="small" muted>{r.driver.make} · {r.driver.color} · {r.driver.plate}</Text>
                {r.driverLocation ? <Text variant="small">{t('mobility.shared.driverPos', { lat: r.driverLocation.lat.toFixed(4), lng: r.driverLocation.lng.toFixed(4) })}</Text> : null}
              </Card>
            </>
          ) : null}
          <Text variant="small" muted>{t('mobility.shared.note')}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
