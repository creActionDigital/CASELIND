import type { DriverProfile, DriverVehicleKind, RideOffers } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { acceptRide, fetchMyRides, fetchOffers, rideKeys, saveDriver, setDriverOnline, useDriverProfile } from '../../../mobility/api';
import { isRideTaken, mobilityErrorMessage } from '../../../mobility/errors';
import { canGoOnline, formatFareRange, hasDriverOnTheWay } from '../../../mobility/logic';
import { useDriverLocation } from '../../../mobility/use-driver-location';
import { imageMime, uploadProductImage } from '../../../media/upload';
import { getDevicePosition } from '../../../places/device-location';
import { formatDistance } from '../../../places/geo';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { fetchKyc } from '../../../wallet/kyc-api';
import { AuthImage, Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Espace chauffeur : devenir chauffeur, profil, interrupteur en ligne, demandes reçues. */
export default function DriverArea() {
  const profile = useDriverProfile();
  const [editing, setEditing] = useState(false);
  if (profile.isPending) return <Loading />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  if (!profile.data || editing) return <DriverForm initial={profile.data ?? null} onDone={() => setEditing(false)} />;
  return <Dashboard profile={profile.data} onEdit={() => setEditing(true)} />;
}

function KycReminder() {
  const { t } = useI18n();
  const router = useRouter();
  const kyc = useQuery({ queryKey: ['kyc', 'status'], queryFn: fetchKyc, retry: false });
  if (kyc.data && kyc.data.level >= 1) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="bodyStrong">{t('mobility.driver.kycTitle')}</Text>
      <Text variant="small" muted>
        {t('mobility.driver.kycBody')}
      </Text>
      <Button variant="secondary" label={t('mobility.driver.kycLink')} onPress={() => router.push('/kyc')} />
    </Card>
  );
}

function Dashboard({ profile, onEdit }: { profile: DriverProfile; onEdit: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const approved = canGoOnline(profile.status);
  const online = profile.online && approved;
  const refreshProfile = () => void qc.invalidateQueries({ queryKey: rideKeys.driver });

  // Position envoyée environ toutes les 20 s tant que le chauffeur est en ligne et cet écran au premier plan.
  useDriverLocation(online, refreshProfile);

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) {
        const pos = await getDevicePosition();
        if (!pos.ok) throw new Error('location');
      }
      await setDriverOnline(next);
    },
    onMutate: () => {
      setError(null);
      setTaken(false);
    },
    onSuccess: () => {
      refreshProfile();
      void qc.invalidateQueries({ queryKey: rideKeys.offers });
    },
    onError: (e) => setError(e instanceof Error && e.message === 'location' ? t('mobility.driver.locationDenied') : mobilityErrorMessage(e, t, locale)),
  });

  const offers = useQuery({ queryKey: rideKeys.offers, queryFn: fetchOffers, enabled: online, refetchInterval: 10_000, retry: false });
  const mine = useQuery({ queryKey: rideKeys.mine('active'), queryFn: () => fetchMyRides('active'), retry: false });
  const activeRide = mine.data?.items.find((r) => r.role === 'driver' && hasDriverOnTheWay(r.status));

  const accept = useMutation({
    mutationFn: (id: string) => acceptRide(id),
    onMutate: () => {
      setError(null);
      setTaken(false);
    },
    onSuccess: (ride) => {
      void qc.invalidateQueries({ queryKey: rideKeys.minePrefix });
      router.push({ pathname: '/rides/[rideId]', params: { rideId: ride.id } });
    },
    onError: (e) => {
      if (isRideTaken(e)) setTaken(true);
      else setError(mobilityErrorMessage(e, t, locale));
      void offers.refetch();
    },
  });

  const items: RideOffers['items'] = offers.data?.items ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.driver.title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {t('mobility.driver.title')}
        </Text>
        <Badge tone={approved ? 'primary' : 'neutral'} label={t(`mobility.driver.status.${profile.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted>
        {profile.vehicle.make} {profile.vehicle.color} · {profile.vehicle.plate}
        {profile.ratingAverage !== null ? ` · ${t('mobility.driver.rating', { avg: profile.ratingAverage.toFixed(1), n: profile.ratingCount })}` : ''}
      </Text>
      {profile.status === 'pending' ? <Text>{t('mobility.driver.status.pendingBody')}</Text> : null}
      {profile.status === 'rejected' ? <Text>{t('mobility.driver.status.rejectedBody')}</Text> : null}
      {profile.status === 'suspended' ? <Text>{t('mobility.driver.status.suspendedBody')}</Text> : null}
      {profile.decisionReason ? (
        <Text variant="small" muted>
          {t('mobility.driver.reason', { reason: profile.decisionReason })}
        </Text>
      ) : null}
      {profile.status !== 'approved' ? <KycReminder /> : null}

      {activeRide ? (
        <Card
          label={t('mobility.driver.activeRide')}
          onPress={() => router.push({ pathname: '/rides/[rideId]', params: { rideId: activeRide.id } })}
          style={{ gap: spacing.xs }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('mobility.driver.activeRide')}
            </Text>
            <Badge tone="accent" label={t(`mobility.status.${activeRide.status}` as MessageKey)} />
          </View>
          <Text variant="small" muted numberOfLines={1}>
            {activeRide.pickup.label} → {activeRide.dropoff.label}
          </Text>
        </Card>
      ) : null}

      <SectionTitle>{online ? t('mobility.driver.online') : t('mobility.driver.offline')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Text variant="small" muted>
          {t('mobility.driver.onlineBody')}
        </Text>
        {!online ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Switch accessibilityRole="switch" accessibilityState={{ checked: consented }}
              value={consented}
              onValueChange={setConsented}
              accessibilityLabel={t('mobility.driver.consent')}
              trackColor={{ true: colors.primary }}
            />
            <Text variant="small" style={{ flex: 1 }}>
              {t('mobility.driver.consent')}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Switch accessibilityRole="switch" accessibilityState={{ checked: online }}
            value={online}
            disabled={!approved || toggle.isPending || (!online && !consented)}
            onValueChange={(v) => toggle.mutate(v)}
            accessibilityLabel={online ? t('mobility.driver.goOffline') : t('mobility.driver.goOnline')}
            trackColor={{ true: colors.primary }}
          />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {online ? t('mobility.driver.goOffline') : t('mobility.driver.goOnline')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </Card>

      <SectionTitle>{t('mobility.driver.offers')}</SectionTitle>
      {taken ? (
        <Card style={{ backgroundColor: colors.dangerSoft }}>
          <Text accessibilityLiveRegion="polite">{t('mobility.driver.taken')}</Text>
        </Card>
      ) : null}
      {!online ? (
        <Text muted>{t('mobility.driver.offlineOffers')}</Text>
      ) : offers.isPending ? (
        <Loading />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : items.length === 0 ? (
        <>
          <Text variant="bodyStrong">{t('mobility.driver.noOffersTitle')}</Text>
          <Text muted>{t('mobility.driver.noOffersBody')}</Text>
        </>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((o) => (
            <Card key={o.id} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {t(`mobility.vehicle.${o.vehicle}` as MessageKey)} · {formatFareRange(o.fare.fareMin, o.fare.fareMax, o.fare.currency, locale)}
                </Text>
              </View>
              <Text variant="small" numberOfLines={1}>
                {o.pickup.label} → {o.dropoff.label}
              </Text>
              <Text variant="small" muted>
                {t('mobility.driver.offerAway', { distance: formatDistance(o.pickupDistanceKm, locale) })} · {formatDistance(o.distanceKm, locale)}
              </Text>
              <Button label={t('mobility.driver.accept')} loading={accept.isPending && accept.variables === o.id} disabled={accept.isPending} onPress={() => accept.mutate(o.id)} />
            </Card>
          ))}
        </View>
      )}

      <Button variant="secondary" label={t('mobility.driver.edit')} onPress={onEdit} />
    </Screen>
  );
}

function DriverForm({ initial, onDone }: { initial: DriverProfile | null; onDone: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [kind, setKind] = useState<DriverVehicleKind>(initial?.vehicle.kind ?? 'moto');
  const [comfort, setComfort] = useState(initial?.vehicle.comfort ?? false);
  const [make, setMake] = useState(initial?.vehicle.make ?? '');
  const [plate, setPlate] = useState(initial?.vehicle.plate ?? '');
  const [color, setColor] = useState(initial?.vehicle.color ?? '');
  const [zone, setZone] = useState(initial?.zone ?? 'Goma');
  const [photo, setPhoto] = useState<{ localUri: string; id?: string; state: 'uploading' | 'ready' | 'failed' } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function pickPhoto() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.85 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      setPhoto({ localUri: a.uri, state: 'uploading' });
      uploadProductImage(a.uri, imageMime(a.mimeType, a.uri)).then(
        (id) => setPhoto({ localUri: a.uri, id, state: 'ready' }),
        () => setPhoto({ localUri: a.uri, state: 'failed' }),
      );
    } catch {
      setPhoto(null);
    }
  }

  const save = useMutation({
    mutationFn: () =>
      saveDriver({
        vehicleKind: kind,
        comfort: kind === 'car' && comfort,
        make: make.trim(),
        plate: plate.trim(),
        color: color.trim(),
        zone: zone.trim(),
        ...(photo?.id ? { photoMediaId: photo.id } : {}),
      }),
    onMutate: () => setError(null),
    onSuccess: (p) => {
      qc.setQueryData(rideKeys.driver, p);
      setSaved(true);
      onDone();
    },
    onError: (e) => setError(mobilityErrorMessage(e, t, locale)),
  });

  const req = (v: string, min = 1) => (submitted && v.trim().length < min ? t('mobility.driver.required') : null);
  function submit() {
    setSubmitted(true);
    if (make.trim().length < 1 || plate.trim().length < 2 || color.trim().length < 1 || zone.trim().length < 1) return;
    if (photo?.state === 'uploading') return;
    save.mutate();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t(initial ? 'mobility.driver.edit' : 'mobility.driver.become') }} />
      <Text variant="title" accessibilityRole="header">
        {t(initial ? 'mobility.driver.edit' : 'mobility.driver.become')}
      </Text>
      {!initial ? <Text muted>{t('mobility.driver.intro')}</Text> : null}
      {initial?.status === 'approved' ? <Text variant="small" muted>{t('mobility.driver.resubmit')}</Text> : null}
      <KycReminder />

      <SectionTitle>{t('mobility.driver.vehicleKind')}</SectionTitle>
      <Chips<DriverVehicleKind>
        scroll={false}
        options={[
          { value: 'moto', label: t('mobility.driver.moto') },
          { value: 'car', label: t('mobility.driver.car') },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'car' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Switch accessibilityRole="switch" accessibilityState={{ checked: comfort }} value={comfort} onValueChange={setComfort} accessibilityLabel={t('mobility.driver.comfort')} trackColor={{ true: colors.primary }} />
          <Text variant="small" style={{ flex: 1 }}>
            {t('mobility.driver.comfort')}
          </Text>
        </View>
      ) : null}
      <TextField label={t('mobility.driver.make')} value={make} onChangeText={setMake} maxLength={60} error={req(make)} />
      <TextField label={t('mobility.driver.plate')} value={plate} onChangeText={setPlate} maxLength={20} autoCapitalize="characters" error={req(plate, 2)} />
      <TextField label={t('mobility.driver.color')} value={color} onChangeText={setColor} maxLength={30} error={req(color)} />
      <TextField label={t('mobility.driver.zone')} value={zone} onChangeText={setZone} maxLength={80} error={req(zone)} />

      <SectionTitle>{t('mobility.driver.photo')}</SectionTitle>
      {photo ? (
        <AuthImage contentUrl={null} localUri={photo.localUri} label={t('mobility.driver.photo')} style={{ width: 160, height: 120 }} />
      ) : initial?.vehicle.photoUrl ? (
        <AuthImage contentUrl={initial.vehicle.photoUrl} label={t('mobility.driver.photo')} style={{ width: 160, height: 120 }} />
      ) : null}
      {photo?.state === 'uploading' ? <Text variant="small" muted>{t('mobility.driver.photoUploading')}</Text> : null}
      {photo?.state === 'failed' ? (
        <Text variant="small" color={colors.danger}>
          {t('mobility.driver.photoFailed')}
        </Text>
      ) : null}
      <Button variant="secondary" label={t(photo || initial?.vehicle.photoUrl ? 'mobility.driver.photoChange' : 'mobility.driver.photoAdd')} onPress={() => void pickPhoto()} />

      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {saved ? <Text variant="small">{t('mobility.driver.saved')}</Text> : null}
      <Button label={t('mobility.driver.save')} loading={save.isPending} disabled={photo?.state === 'uploading'} onPress={submit} />
      {initial ? <Button variant="ghost" label={t('common.cancel')} onPress={onDone} /> : null}
    </Screen>
  );
}
