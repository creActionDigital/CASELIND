import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  cancelCourierRequest,
  courierKeys,
  deliveredCourierRequest,
  fetchCourierRequest,
  pickedUpCourierRequest,
  postCourierLocation,
  rateCourierRequest,
  resetCourierProof,
  setCourierLocationConsent,
} from '../../../courier/api';
import { courierErrorMessage } from '../../../courier/errors';
import { courierActions, formatCourierCode, isCompleteCourierCode, isLiveCourier } from '../../../courier/logic';
import { createLocationPump } from '../../../delivery/logic';
import { isLocationStop } from '../../../delivery/errors';
import { formatSlot } from '../../../delivery/schedule-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { getDevicePosition } from '../../../places/device-location';
import { TileMap } from '../../../places/TileMap';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Suivi d'une demande de coursier, côté demandeur (code, annulation, position) et côté coursier (étapes, code de remise). */
export default function CourierRequestDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId);
  const q = useQuery({
    queryKey: courierKeys.one(id),
    queryFn: () => fetchCourierRequest(id),
    retry: false,
    refetchInterval: (query) => (query.state.data && isLiveCourier(query.state.data.status) ? 15_000 : false),
  });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const done = (r: unknown) => {
    qc.setQueryData(courierKeys.one(id), r);
    void qc.invalidateQueries({ queryKey: courierKeys.all });
    setError(null);
  };
  const fail = (e: unknown) => setError(courierErrorMessage(e, t, locale));
  const cancel = useMutation({ mutationFn: () => cancelCourierRequest(id), onSuccess: done, onError: fail });
  const pickedUp = useMutation({ mutationFn: () => pickedUpCourierRequest(id), onSuccess: done, onError: fail });
  const delivered = useMutation({
    mutationFn: () => deliveredCourierRequest(id, code),
    onSuccess: (r) => {
      setCode('');
      done(r);
    },
    onError: fail,
  });
  const resetCode = useMutation({ mutationFn: () => resetCourierProof(id), onSuccess: done, onError: fail });
  const rate = useMutation({ mutationFn: (n: number) => rateCourierRequest(id, n), onSuccess: done, onError: fail });
  const consent = useMutation({ mutationFn: (granted: boolean) => setCourierLocationConsent(id, granted), onSuccess: done, onError: fail });

  // Position du coursier : consentie, colis récupéré seulement, un point toutes les 30 s (rien n'est mémorisé côté appareil).
  const sharing = q.data?.role === 'courier' && q.data.status === 'picked_up' && q.data.locationSharing;
  const stopped = useRef(() => {});
  stopped.current = () => void qc.invalidateQueries({ queryKey: courierKeys.one(id) });
  useEffect(() => {
    if (!sharing) return;
    const pump = createLocationPump({
      getPosition: async () => {
        const r = await getDevicePosition();
        return r.ok ? r.position : null;
      },
      send: (p) => postCourierLocation(id, p.lat, p.lng),
      shouldStop: isLocationStop,
      onStop: () => stopped.current(),
    });
    pump.start();
    return () => pump.stop();
  }, [sharing, id]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const actions = courierActions(r.status, r.role, r.ratingGiven !== null);
  const kindLabel = t(`courier.kind.${r.kind}` as MessageKey);

  return (
    <Screen>
      <Stack.Screen options={{ title: kindLabel }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text variant="title" style={{ flex: 1 }}>
          {kindLabel}
          {r.size ? ` · ${t(`courier.size.${r.size}` as MessageKey)}` : ''}
        </Text>
        <Badge tone="accent" label={t(`courier.status.${r.status}` as MessageKey)} />
      </View>
      <Text muted>{t('courier.cash')}</Text>

      <Card>
        <Text variant="caption" muted>
          {t('mobility.pickup')}
        </Text>
        <Text variant="bodyStrong">{r.pickup.label}</Text>
        <Text variant="caption" muted>
          {t('mobility.dropoff')}
        </Text>
        <Text variant="bodyStrong">{r.dropoff.label}</Text>
        <Text variant="small" muted>
          {formatMoney(r.feeMinor, r.currency, locale)} · {t('courier.estimated')}
        </Text>
        {r.scheduledFor ? (
          <Text variant="small" muted>
            {t('courier.slot.at', { when: formatSlot(r.scheduledFor, locale) })}
          </Text>
        ) : null}
        {r.note ? (
          <Text variant="small">
            {t('courier.note')} : {r.note}
          </Text>
        ) : null}
      </Card>

      {r.counterpart ? (
        <Text>
          {t(r.role === 'requester' ? 'courier.courierIs' : 'courier.requesterIs', { name: r.counterpart.displayName })}
        </Text>
      ) : r.status === 'requested' ? (
        <Text muted>{t('courier.waiting')}</Text>
      ) : null}

      {r.role === 'requester' && r.proofCode ? (
        <Card>
          <Text variant="caption" muted>
            {t('courier.code.title')}
          </Text>
          <Text variant="title" accessibilityLabel={r.proofCode.split('').join(' ')}>
            {formatCourierCode(r.proofCode)}
          </Text>
          <Text variant="small" muted>
            {t('courier.code.body')}
          </Text>
          {r.proofLockedUntil ? <Text color={colors.danger}>{t('courier.error.proof_locked')}</Text> : null}
        </Card>
      ) : null}

      {r.location ? (
        <TileMap
          style={{ height: 200, borderRadius: 12 }}
          fit={[r.location]}
          fitKey={`${r.location.lat},${r.location.lng}`}
          markers={[{ id: 'courier', lat: r.location.lat, lng: r.location.lng, label: r.counterpart?.displayName ?? t('courier.title'), selected: true }]}
        />
      ) : null}

      {error ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {actions.includes('pickedUp') ? <Button label={t('courier.action.pickedUp')} loading={pickedUp.isPending} onPress={() => pickedUp.mutate()} /> : null}
      {actions.includes('delivered') ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('courier.action.deliveredTitle')}</SectionTitle>
          <TextField label={t('courier.code.field')} hint={t('courier.code.fieldHint')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
          <Button label={t('courier.action.delivered')} disabled={!isCompleteCourierCode(code)} loading={delivered.isPending} onPress={() => delivered.mutate()} />
        </View>
      ) : null}
      {actions.includes('shareLocation') ? (
        <Button
          variant="secondary"
          label={t(r.locationSharing ? 'courier.location.stop' : 'courier.location.start')}
          loading={consent.isPending}
          onPress={() => consent.mutate(!r.locationSharing)}
        />
      ) : null}
      {actions.includes('resetCode') ? (
        <Button
          variant="secondary"
          label={t('courier.action.resetCode')}
          loading={resetCode.isPending}
          onPress={() =>
            alertConfirm(t('courier.resetCode.title'), t('courier.resetCode.body'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('courier.action.resetCode'), style: 'destructive', onPress: () => resetCode.mutate() },
            ])
          }
        />
      ) : null}
      {actions.includes('rate') ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('courier.rate.title')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Button key={n} variant="secondary" label={String(n)} onPress={() => rate.mutate(n)} />
            ))}
          </View>
        </View>
      ) : null}
      {r.ratingGiven !== null ? <Text muted>{t('courier.rate.given', { n: r.ratingGiven })}</Text> : null}
      {actions.includes('cancel') ? (
        <Button
          variant="ghost"
          label={t('courier.action.cancel')}
          loading={cancel.isPending}
          onPress={() =>
            alertConfirm(t('courier.cancel.title'), t('courier.cancel.body'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('courier.action.cancel'), style: 'destructive', onPress: () => cancel.mutate() },
            ])
          }
        />
      ) : null}
    </Screen>
  );
}
