import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { courierKeys, fetchCourierJobs, fetchRoutePlan } from '../../../courier/api';
import { courierErrorMessage } from '../../../courier/errors';
import { planIds } from '../../../courier/logic';
import { deliveryKeys, fetchMyDeliveries } from '../../../delivery/api';
import { useI18n, type MessageKey } from '../../../i18n';
import { formatDistance, GOMA_CENTER, type LatLng } from '../../../places/geo';
import { getDevicePosition } from '../../../places/device-location';
import { TileMap } from '../../../places/TileMap';
import { Card } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** « Ma tournée » : ordre de passage proposé (plus proche d'abord, retrait avant remise) pour mes courses et mes livraisons en cours. */
export default function CourierRoute() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [posError, setPosError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setPosError(null);
    const r = await getDevicePosition();
    if (r.ok) setPos(r.position);
    else setPosError(t(r.reason === 'denied' ? 'mobility.place.denied' : 'mobility.place.unavailable'));
  }, [t]);
  useEffect(() => {
    void locate();
  }, [locate]);

  const jobs = useQuery({ queryKey: courierKeys.jobs('active'), queryFn: () => fetchCourierJobs('active'), retry: false });
  const deliveries = useQuery({ queryKey: deliveryKeys.mine('active'), queryFn: () => fetchMyDeliveries('active'), retry: false });
  const ids = jobs.data && deliveries.data ? planIds(jobs.data.items, deliveries.data.items.map((d) => d.id)) : [];
  const plan = useQuery({
    queryKey: courierKeys.plan(ids.join(','), pos?.lat ?? 0, pos?.lng ?? 0),
    queryFn: () => fetchRoutePlan(ids, pos!.lat, pos!.lng),
    enabled: !!pos && ids.length > 0,
    retry: false,
  });

  const located = (plan.data?.stops ?? []).filter((s) => s.lat !== null && s.lng !== null);
  const points = [...(pos ? [pos] : []), ...located.map((s) => ({ lat: s.lat!, lng: s.lng! }))];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('courier.route.title') }} />
      <Text muted>{t('courier.route.intro')}</Text>
      {posError ? (
        <View style={{ gap: spacing.sm }}>
          <Text color={colors.danger}>{posError}</Text>
          <Button variant="secondary" label={t('courier.available.locate')} onPress={() => void locate()} />
        </View>
      ) : null}
      {jobs.isPending || deliveries.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      {jobs.isError || deliveries.isError ? (
        <ErrorState
          error={jobs.error ?? deliveries.error}
          onRetry={() => {
            void jobs.refetch();
            void deliveries.refetch();
          }}
        />
      ) : null}
      {jobs.isSuccess && deliveries.isSuccess && ids.length === 0 ? (
        <EmptyState icon="map-outline" title={t('courier.route.emptyTitle')} body={t('courier.route.emptyBody')} />
      ) : null}
      {plan.isError ? <Text color={colors.danger}>{courierErrorMessage(plan.error, t, locale)}</Text> : null}
      {plan.data ? (
        <>
          <TileMap
            style={{ height: 220, borderRadius: radius.lg }}
            fit={points.length > 0 ? points : [GOMA_CENTER]}
            fitKey={points.map((p) => `${p.lat},${p.lng}`).join('|') || 'goma'}
            markers={located.map((s, i) => ({ id: `${s.id}:${s.step}`, lat: s.lat!, lng: s.lng!, label: `${i + 1}. ${s.label}` }))}
            user={pos}
            line={points}
          />
          <Text variant="bodyStrong">{t('courier.route.total', { distance: formatDistance(plan.data.totalKm, locale) })}</Text>
          <Text variant="small" muted>
            {t('courier.route.estimate')}
          </Text>
          {plan.data.stops.map((s, i) => (
            <Card key={`${s.id}:${s.step}`} label={`${i + 1}. ${t(`courier.route.step.${s.step}` as MessageKey)}, ${s.label}`} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {i + 1}. {s.label}
                </Text>
                {s.express ? <Badge tone="accent" label={t('courier.speed.express')} /> : null}
              </View>
              <Text variant="small" muted>
                {t(`courier.route.step.${s.step}` as MessageKey)}
                {s.legKm !== null ? ` · ${formatDistance(s.legKm, locale)}` : ` · ${t('courier.route.noCoords')}`}
              </Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
