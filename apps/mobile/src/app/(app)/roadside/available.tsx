import type { RoadsideRequest } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { extraKeys, fetchMyRoadside, fetchRoadsideOffers, roadsideConsent, roadsideOnTheWay, roadsideStep } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { parseEta, roadsideActions } from '../../../mobility/extra/logic';
import { useRoadsideLocation } from '../../../mobility/extra/use-roadside-location';
import { ErrorLine } from '../../../mobility/extra/ui';
import { getDevicePosition } from '../../../places/device-location';
import type { LatLng } from '../../../places/geo';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatDistance } from '../../../places/geo';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Un travail en cours : en route, terminé, désistement, partage de position avec consentement. */
function Job({ r, onError, onChanged }: { r: RoadsideRequest; onError: (e: unknown) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [eta, setEta] = useState(r.etaMinutes ? String(r.etaMinutes) : '15');
  const [etaError, setEtaError] = useState(false);
  const a = roadsideActions('provider', r.status);
  const done = { onSuccess: onChanged, onError };
  const way = useMutation({ mutationFn: (n: number) => roadsideOnTheWay(r.id, n), ...done });
  const finish = useMutation({ mutationFn: () => roadsideStep(r.id, 'done'), ...done });
  const release = useMutation({ mutationFn: () => roadsideStep(r.id, 'release'), ...done });
  const consent = useMutation({ mutationFn: (granted: boolean) => roadsideConsent(r.id, granted), ...done });
  // Position envoyée seulement avec le consentement et tant que l’écran est au premier plan.
  useRoadsideLocation(r.locationSharing && a.consent, r.id, onChanged);

  return (
    <Card style={{ gap: spacing.xs, marginTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t(`roadside.kind.${r.kind}` as MessageKey)}
        </Text>
        <Badge tone="accent" label={t(`roadside.status.${r.status}` as MessageKey)} />
      </View>
      <Text variant="small">{r.position.label}</Text>
      {r.vehicleLabel ? <Text variant="small" muted>{r.vehicleLabel}</Text> : null}
      {r.note ? <Text variant="small">{r.note}</Text> : null}
      {r.counterpart ? <Text variant="small" muted>{t('roadside.requester', { name: r.counterpart.displayName })}</Text> : null}
      {a.onTheWay ? (
        <View style={{ gap: spacing.xs }}>
          <TextField label={t('roadside.etaField')} value={eta} onChangeText={setEta} keyboardType="number-pad" maxLength={3} />
          {etaError ? <ErrorLine message={t('roadside.etaInvalid')} /> : null}
          <Button
            label={t('roadside.onTheWay')}
            loading={way.isPending}
            onPress={() => {
              const n = parseEta(eta);
              setEtaError(n === null);
              if (n !== null) way.mutate(n);
            }}
          />
        </View>
      ) : null}
      {a.consent ? (
        <View style={{ gap: spacing.xs }}>
          <Text variant="small" muted>
            {t('roadside.consent.body')}
          </Text>
          <Button variant="secondary" label={t(r.locationSharing ? 'roadside.consent.stop' : 'roadside.consent.start')} loading={consent.isPending} onPress={() => consent.mutate(!r.locationSharing)} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {a.done ? <Button label={t('roadside.done')} loading={finish.isPending} onPress={() => finish.mutate()} /> : null}
        {a.release ? (
          <Button
            variant="secondary"
            label={t('roadside.release')}
            onPress={() =>
              alertConfirm(t('roadside.release.confirm'), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('roadside.release'), style: 'destructive', onPress: () => release.mutate() },
              ])
            }
          />
        ) : null}
      </View>
    </Card>
  );
}

/** Prestataires (chauffeurs approuvés) : demandes de dépannage ouvertes autour de ma position, premier arrivé premier servi. */
export default function RoadsideAvailable() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [pos, setPos] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offers = useQuery({
    queryKey: [...extraKeys.roadsideOffers, pos?.lat, pos?.lng],
    queryFn: () => fetchRoadsideOffers(pos!.lat, pos!.lng),
    enabled: pos !== null,
    refetchInterval: 15_000,
    retry: false,
  });
  const jobs = useQuery({ queryKey: extraKeys.roadsideMine('provider'), queryFn: () => fetchMyRoadside('provider'), refetchInterval: 10_000, retry: false });
  const changed = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: extraKeys.roadsideAll });
  };
  const fail = (e: unknown) => {
    setError(extraErrorMessage(e, t, locale));
    void qc.invalidateQueries({ queryKey: extraKeys.roadsideAll });
  };
  const accept = useMutation({ mutationFn: (id: string) => roadsideStep(id, 'accept'), onSuccess: changed, onError: fail });

  async function locate() {
    setLocating(true);
    setNote(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) setPos(r.position);
    else setNote(t(r.reason === 'denied' ? 'mobility.place.denied' : 'mobility.place.unavailable'));
  }

  const underWay = jobs.data?.items.filter((r) => r.status === 'accepted' || r.status === 'on_the_way') ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('roadside.available.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('roadside.available.title')}
      </Text>
      <Text muted>{t('roadside.available.intro')}</Text>
      <ErrorLine message={error} />

      {jobs.isPending ? <Loading /> : null}
      {underWay.length > 0 ? <SectionTitle>{t('roadside.jobs')}</SectionTitle> : null}
      {underWay.map((r) => (
        <Job key={r.id} r={r} onError={fail} onChanged={changed} />
      ))}

      <SectionTitle>{t('roadside.nearby')}</SectionTitle>
      <Button variant="secondary" label={t(pos ? 'roadside.relocate' : 'roadside.locate')} loading={locating} onPress={() => void locate()} />
      <ErrorLine message={note} />
      {offers.isError ? <ErrorState error={offers.error} onRetry={() => offers.refetch()} /> : null}
      {pos && offers.isSuccess && offers.data.items.length === 0 ? <EmptyState icon="construct-outline" title={t('roadside.available.empty')} /> : null}
      {offers.data?.items.map((o) => (
        <Card key={o.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t(`roadside.kind.${o.kind}` as MessageKey)}
            </Text>
            <Badge tone="neutral" label={formatDistance(o.distanceKm, locale)} />
          </View>
          <Text variant="small" muted>
            {t('roadside.offer.approx')}
          </Text>
          <Button label={t('roadside.accept')} loading={accept.isPending} onPress={() => accept.mutate(o.id)} />
        </Card>
      ))}
      <Text variant="small" muted>
        {t('roadside.cash')}
      </Text>
    </Screen>
  );
}
