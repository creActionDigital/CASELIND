import type { CourierOffer } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { acceptCourierRequest, courierKeys, fetchCourierJobs, fetchCourierOffers } from '../../../courier/api';
import { courierErrorMessage, isCourierRequestTaken } from '../../../courier/errors';
import { formatSlot } from '../../../delivery/schedule-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { formatDistance, type LatLng } from '../../../places/geo';
import { getDevicePosition } from '../../../places/device-location';
import { Card, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, Screen, Text } from '../../../ui';

/** Coursier : demandes à proximité (coordonnées arrondies, sans adresse ni note avant l'acceptation), mes courses en cours. */
export default function CourierAvailable() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setPosError(null);
    const r = await getDevicePosition();
    if (r.ok) setPos(r.position);
    else setPosError(t(r.reason === 'denied' ? 'mobility.place.denied' : 'mobility.place.unavailable'));
  }, [t]);
  useEffect(() => {
    void locate();
  }, [locate]);

  const offers = useQuery({
    queryKey: [...courierKeys.offers, pos?.lat, pos?.lng],
    queryFn: () => fetchCourierOffers(pos!.lat, pos!.lng),
    enabled: !!pos,
    retry: false,
    refetchInterval: 20_000,
  });
  const jobs = useQuery({ queryKey: courierKeys.jobs('active'), queryFn: () => fetchCourierJobs('active'), retry: false });

  const accept = useMutation({
    mutationFn: (id: string) => acceptCourierRequest(id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: courierKeys.all });
      router.push({ pathname: '/courier/[id]', params: { id: r.id } });
    },
    onError: (e) => {
      setError(courierErrorMessage(e, t, locale));
      if (isCourierRequestTaken(e)) void offers.refetch();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('courier.available.title') }} />
      <Text muted>{t('courier.available.intro')}</Text>

      {jobs.data && jobs.data.items.length > 0 ? (
        <>
          <SectionTitle>{t('courier.available.jobs')}</SectionTitle>
          {jobs.data.items.map((j) => (
            <Card key={j.id} label={`${t(`courier.kind.${j.kind}` as MessageKey)}, ${t(`courier.status.${j.status}` as MessageKey)}`} onPress={() => router.push({ pathname: '/courier/[id]', params: { id: j.id } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {j.pickup.label} → {j.dropoff.label}
                </Text>
                <Badge tone="accent" label={t(`courier.status.${j.status}` as MessageKey)} />
              </View>
            </Card>
          ))}
          <Button variant="secondary" label={t('courier.link.route')} onPress={() => router.push('/courier/route')} />
        </>
      ) : null}

      <SectionTitle>{t('courier.available.nearby')}</SectionTitle>
      {posError ? (
        <View style={{ gap: spacing.sm }}>
          <Text color={colors.danger}>{posError}</Text>
          <Button variant="secondary" label={t('courier.available.locate')} onPress={() => void locate()} />
        </View>
      ) : null}
      {error ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {jobs.isError ? <Text color={colors.danger}>{courierErrorMessage(jobs.error, t, locale)}</Text> : null}
      {(!pos && !posError) || (!!pos && offers.isPending) ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : offers.isError ? (
        <View style={{ gap: spacing.sm }}>
          <Text color={colors.danger}>{courierErrorMessage(offers.error, t, locale)}</Text>
          <Button variant="secondary" label={t('courier.link.driver')} onPress={() => router.push('/rides/driver')} />
        </View>
      ) : offers.data && offers.data.items.length === 0 ? (
        <EmptyState icon="cube-outline" title={t('courier.available.emptyTitle')} body={t('courier.available.emptyBody')} />
      ) : (
        (offers.data?.items ?? []).map((o) => <OfferCard key={o.id} o={o} busy={accept.isPending && accept.variables === o.id} onAccept={() => accept.mutate(o.id)} />)
      )}
    </Screen>
  );
}

function OfferCard({ o, busy, onAccept }: { o: CourierOffer; busy: boolean; onAccept: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Card label={`${t(`courier.kind.${o.kind}` as MessageKey)}, ${formatMoney(o.feeMinor, o.currency, locale)}`} style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t(`courier.kind.${o.kind}` as MessageKey)}
          {o.size ? ` · ${t(`courier.size.${o.size}` as MessageKey)}` : ''}
        </Text>
        <Text variant="bodyStrong">{formatMoney(o.feeMinor, o.currency, locale)}</Text>
      </View>
      <Text variant="small" muted>
        {t('courier.available.distances', { pickup: formatDistance(o.pickupDistanceKm, locale), trip: formatDistance(o.tripKm, locale) })}
      </Text>
      {o.scheduledFor ? (
        <Text variant="small" muted>
          {t('courier.slot.at', { when: formatSlot(o.scheduledFor, locale) })}
        </Text>
      ) : null}
      <Text variant="caption" muted>
        {t('courier.available.privacy')}
      </Text>
      <Button label={t('courier.available.accept')} loading={busy} onPress={onAccept} />
    </Card>
  );
}
