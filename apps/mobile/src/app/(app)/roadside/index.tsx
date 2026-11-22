import type { RidePoint, RoadsideKind, RoadsideRequest } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { createRoadside, extraKeys, fetchMyRoadside, roadsideStep } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { isRoadsideLive, minutesLeft, roadsideActions } from '../../../mobility/extra/logic';
import { ErrorLine, PlaceRow } from '../../../mobility/extra/ui';
import { PlaceSheet } from '../../../mobility/ui';
import { TileMap } from '../../../places/TileMap';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const KINDS: RoadsideKind[] = ['tow', 'battery', 'tire', 'fuel', 'lockout', 'other'];

/** Demande de dépannage (bouton SOS) : type, position (de l’appareil ou saisie), suivi de la demande. Prix convenu sur place, en espèces. */
export default function RoadsideHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [kind, setKind] = useState<RoadsideKind>('battery');
  const [point, setPoint] = useState<RidePoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Suivi : la demande avance sans action de ma part (acceptation, trajet, position du prestataire).
  const mine = useQuery({ queryKey: extraKeys.roadsideMine('requester'), queryFn: () => fetchMyRoadside('requester'), refetchInterval: 10_000, retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: extraKeys.roadsideAll });

  const send = useMutation({
    mutationFn: () => createRoadside({ kind, position: point!, ...(vehicle.trim() ? { vehicleLabel: vehicle.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setNote('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(extraErrorMessage(e, t, locale)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => roadsideStep(id, 'cancel'), onSuccess: refresh, onError: (e) => setError(extraErrorMessage(e, t, locale)) });

  const live = mine.data?.items.filter((r) => isRoadsideLive(r.status)) ?? [];
  const past = mine.data?.items.filter((r) => !isRoadsideLive(r.status)).slice(0, 5) ?? [];

  const card = (r: RoadsideRequest) => (
    <Card key={r.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t(`roadside.kind.${r.kind}` as MessageKey)}
        </Text>
        <Badge tone="accent" label={t(`roadside.status.${r.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted numberOfLines={2}>
        {r.position.label}
      </Text>
      {r.status === 'requested' ? <Text variant="small">{t('roadside.waiting', { min: minutesLeft(r.expiresAt, Date.now()) })}</Text> : null}
      {r.counterpart ? <Text variant="small">{t('roadside.provider', { name: r.counterpart.displayName })}</Text> : null}
      {r.etaMinutes !== null && r.status === 'on_the_way' ? <Text variant="bodyStrong">{t('roadside.eta', { min: r.etaMinutes })}</Text> : null}
      {r.providerLocation ? (
        <TileMap
          style={{ height: 180, borderRadius: radius.lg }}
          fit={[r.position, r.providerLocation]}
          fitKey={r.id}
          markers={[
            { id: 'me', lat: r.position.lat, lng: r.position.lng, label: t('roadside.you') },
            { id: 'p', lat: r.providerLocation.lat, lng: r.providerLocation.lng, label: t('roadside.providerMarker'), selected: true },
          ]}
        />
      ) : r.status === 'on_the_way' ? (
        <Text variant="small" muted>
          {t('roadside.noLocation')}
        </Text>
      ) : null}
      {roadsideActions('requester', r.status).cancel ? (
        <Button
          variant="danger"
          label={t('roadside.cancel')}
          loading={cancel.isPending}
          onPress={() =>
            alertConfirm(t('roadside.cancel.confirm'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('roadside.cancel'), style: 'destructive', onPress: () => cancel.mutate(r.id) },
            ])
          }
        />
      ) : null}
    </Card>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('roadside.title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md }}>
        <Ionicons name="warning-outline" size={26} color={colors.danger} />
        <Text variant="small" style={{ flex: 1 }} accessibilityRole="alert">
          {t('roadside.safety')}
        </Text>
      </View>
      <Text variant="title" accessibilityRole="header">
        {t('roadside.sos')}
      </Text>
      <Text muted>{t('roadside.intro')}</Text>

      <View style={{ marginHorizontal: -spacing.lg }}><Chips<RoadsideKind> options={KINDS.map((k) => ({ value: k, label: t(`roadside.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} /></View>
      <PlaceRow label={t('roadside.position')} point={point} icon="radio-button-on" onPress={() => setPicking(true)} />
      <TextField label={t('roadside.vehicle')} value={vehicle} onChangeText={setVehicle} maxLength={60} />
      <TextField label={t('roadside.note')} value={note} onChangeText={setNote} maxLength={200} multiline />
      <ErrorLine message={error} />
      <Button
        label={t('roadside.send')}
        disabled={!point}
        loading={send.isPending}
        onPress={() => {
          setError(null);
          send.mutate();
        }}
      />
      <Text variant="small" muted>
        {t('roadside.cash')}
      </Text>

      {mine.isPending ? <Loading /> : mine.isError ? <ErrorState error={mine.error} onRetry={() => mine.refetch()} /> : null}
      {live.length > 0 ? <SectionTitle>{t('roadside.live')}</SectionTitle> : null}
      {live.map(card)}
      {past.length > 0 ? <SectionTitle>{t('roadside.past')}</SectionTitle> : null}
      {past.map(card)}

      <Button variant="secondary" label={t('roadside.link.available')} onPress={() => router.push('/roadside/available' as never)} />
      <PlaceSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPoint(p);
          setPicking(false);
        }}
      />
    </Screen>
  );
}
