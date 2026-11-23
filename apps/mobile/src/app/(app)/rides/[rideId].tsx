import { QUICK_MESSAGES, type CancelReason, type QuickMessageCode, type RideView } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createURL } from 'expo-linking';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, View } from 'react-native';
import { SheetModal } from '../../../components/SheetModal';
import { distanceKm } from '../../../delivery/logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { shareMessage } from '../../../lib/share';
import { ApiRequestError } from '../../../lib/api';
import {
  alertRide,
  cancelRide,
  completeRide,
  fetchReceipt,
  fetchRideMessages,
  markArrived,
  rateRide,
  rideKeys,
  sendRideMessage,
  shareRide,
  startRide,
} from '../../../mobility/api';
import { mobilityErrorMessage, startCodeFailure } from '../../../mobility/errors';
import {
  canDo,
  fareLine,
  formatStartCode,
  hasDriverOnTheWay,
  isCompleteStartCode,
  isFinishedRide,
  type RideRole,
} from '../../../mobility/logic';
import { CancelSheet, RatingForm, Row } from '../../../mobility/ui';
import { useDriverLocation } from '../../../mobility/use-driver-location';
import { useRide } from '../../../mobility/use-ride';
import { directionsUrl, formatDistance } from '../../../places/geo';
import { openReport } from '../../../report/open-report';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { PinPad } from '../../../wallet/ui';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

const CODES = Object.keys(QUICK_MESSAGES) as QuickMessageCode[];
const platform = () => (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');

/** Course en direct, pour le passager comme pour le chauffeur (le rôle vient de la course). */
export default function RideScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const id = String(rideId);
  const q = useRide(id);
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <RideBody ride={q.data} refetch={() => void q.refetch()} />;
}

function RideBody({ ride, refetch }: { ride: RideView; refetch: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const id = ride.id;
  const role: RideRole = ride.role;
  const status = ride.status;
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [rated, setRated] = useState(false);

  const store = (r: RideView) => {
    qc.setQueryData(rideKeys.ride(id), r);
    void qc.invalidateQueries({ queryKey: rideKeys.minePrefix });
  };
  const fail = (e: unknown) => {
    setError(mobilityErrorMessage(e, t, locale));
    if (e instanceof ApiRequestError && (e.status === 409 || e.status === 404)) refetch();
  };

  // Le chauffeur émet sa position pendant toute la course (écran au premier plan seulement).
  useDriverLocation(role === 'driver' && hasDriverOnTheWay(status), refetch);

  const live = hasDriverOnTheWay(status);
  const messages = useQuery({ queryKey: rideKeys.messages(id), queryFn: () => fetchRideMessages(id), enabled: live, retry: false });
  const receipt = useQuery({ queryKey: rideKeys.receipt(id), queryFn: () => fetchReceipt(id), enabled: status === 'completed', retry: false });

  const cancel = useMutation({
    mutationFn: (reason: CancelReason) => cancelRide(id, reason),
    onSuccess: (r) => {
      store(r);
      setCancelling(false);
    },
    onError: fail,
  });
  const arrived = useMutation({ mutationFn: () => markArrived(id), onMutate: () => setError(null), onSuccess: store, onError: fail });
  const start = useMutation({
    mutationFn: () => startRide(id, code),
    onMutate: () => {
      setError(null);
      setCodeError(null);
    },
    onSuccess: (r) => {
      setCode('');
      store(r);
    },
    onError: (e) => {
      if (startCodeFailure(e)) {
        setCode('');
        setCodeError(mobilityErrorMessage(e, t, locale));
        return;
      }
      fail(e);
    },
  });
  const complete = useMutation({ mutationFn: () => completeRide(id), onMutate: () => setError(null), onSuccess: store, onError: fail });
  const send = useMutation({
    mutationFn: (c: QuickMessageCode) => sendRideMessage(id, c),
    onMutate: () => setError(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rideKeys.messages(id) }),
    onError: fail,
  });
  const share = useMutation({
    mutationFn: () => shareRide(id),
    onMutate: () => setError(null),
    onSuccess: (s) => {
      void shareMessage({ message: t('mobility.share.message', { link: createURL(`/rides/shared/${encodeURIComponent(s.token)}`) }) }, t('share.copied'));
      void qc.invalidateQueries({ queryKey: rideKeys.ride(id) });
    },
    onError: fail,
  });
  const alert = useMutation({
    mutationFn: () => alertRide(id),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setAlerting(false);
      setInfo(r.notified > 0 ? t('mobility.alert.done', { n: r.notified }) : t('mobility.alert.none'));
    },
    onError: (e) => {
      setAlerting(false);
      fail(e);
    },
  });
  const rate = useMutation({
    mutationFn: (v: { rating: number; comment: string }) => rateRide(id, { rating: v.rating, ...(v.comment ? { comment: v.comment } : {}) }),
    onSuccess: () => setRated(true),
    onError: (e) => {
      if (e instanceof ApiRequestError && (e.detail<string>('reason') === 'already_rated' || e.code === 'already_rated')) return setRated(true);
    },
  });

  const fare = fareLine(ride, locale);
  const point = status === 'in_progress' ? ride.dropoff : ride.pickup;
  const driverKm = ride.driverLocation && role === 'rider' ? distanceKm(ride.driverLocation, point) : null;
  const showCode = role === 'rider' && ride.startCode && (status === 'accepted' || status === 'driver_arriving');
  const actions = (a: Parameters<typeof canDo>[2]) => canDo(status, role, a);
  const statusLabel = t(`mobility.status.${status}` as MessageKey);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.ride.title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {statusLabel}
        </Text>
        <Badge tone={isFinishedRide(status) && status !== 'completed' ? 'neutral' : 'accent'} label={t(`mobility.vehicle.${ride.vehicle}` as MessageKey)} />
      </View>
      <View accessibilityLiveRegion="polite">
        {status === 'requested' ? (
          <View style={{ gap: spacing.sm }}>
            <ActivityIndicator color={colors.primary} accessibilityLabel={t('mobility.ride.searching')} />
            <Text variant="bodyStrong">{t('mobility.ride.searching')}</Text>
            <Text muted>{t('mobility.ride.searchingBody')}</Text>
          </View>
        ) : null}
        {status === 'scheduled' && ride.scheduledAt ? (
          <Text variant="bodyStrong">
            {t('mobility.ride.scheduledFor', { when: new Date(ride.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
          </Text>
        ) : null}
        {status === 'expired' ? <Text muted>{t('mobility.ride.expiredBody')}</Text> : null}
        {ride.cancelReason && (status === 'cancelled_by_rider' || status === 'cancelled_by_driver') ? (
          <Text muted>{t('mobility.ride.cancelReason', { reason: t(`mobility.cancel.reason.${ride.cancelReason}` as MessageKey) })}</Text>
        ) : null}
      </View>

      {showCode ? (
        <Card style={{ alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primarySoft }}>
          <Text variant="small" muted>
            {t('mobility.ride.startCode')}
          </Text>
          <Text
            variant="display"
            selectable
            accessibilityLabel={`${t('mobility.ride.startCode')} ${ride.startCode!.split('').join(' ')}`}
            style={{ fontSize: 56, lineHeight: 64, letterSpacing: 8, fontVariant: ['tabular-nums'] }}
          >
            {formatStartCode(ride.startCode!)}
          </Text>
          <Text variant="small" muted style={{ textAlign: 'center' }}>
            {t('mobility.ride.startCodeBody')}
          </Text>
        </Card>
      ) : null}

      {ride.driver && role === 'rider' && live ? (
        <>
          <SectionTitle>{t('mobility.ride.driver')}</SectionTitle>
          <Card style={{ gap: spacing.xs }}>
            <Text variant="bodyStrong">{ride.driver.displayName}</Text>
            <Text variant="small">
              {t('mobility.ride.vehicleLine', { make: ride.driver.vehicle.make, color: ride.driver.vehicle.color, plate: ride.driver.vehicle.plate })}
            </Text>
            {ride.driver.ratingAverage !== null ? (
              <Text variant="small" muted>
                {ride.driver.ratingAverage.toFixed(1)} / 5
              </Text>
            ) : null}
            <Text variant="small" accessibilityLiveRegion="polite" color={driverKm === null ? colors.textMuted : undefined}>
              {driverKm !== null ? t('mobility.ride.driverDistance', { distance: formatDistance(driverKm, locale) }) : t('mobility.ride.driverWaiting')}
            </Text>
          </Card>
        </>
      ) : null}

      {role === 'driver' ? (
        <>
          <SectionTitle>{t('mobility.ride.rider')}</SectionTitle>
          <Card>
            <Text variant="bodyStrong">{ride.rider.displayName}</Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('mobility.ride.route')}</SectionTitle>
      <Card style={{ gap: spacing.xs }}>
        <Row label={t('mobility.pickup')} value={ride.pickup.label} />
        {ride.stop ? <Row label={t('mobility.stop')} value={ride.stop.label} /> : null}
        <Row label={t('mobility.dropoff')} value={ride.dropoff.label} />
        <Row label={fare.final ? t('mobility.ride.fareFinal') : t('mobility.ride.fare')} value={fare.final ? fare.text : `${fare.text} (${t('mobility.estimated')})`} />
        <Text variant="small" muted>
          {t('mobility.cash')}
        </Text>
      </Card>
      {role === 'driver' && live ? (
        <Card style={{ gap: spacing.xs }}>
          <Text variant="small" muted>
            {t('mobility.ride.collect')}
          </Text>
          <Text variant="heading">{formatMoney(ride.finalFareMinor ?? ride.fare.fareMinor, ride.fare.currency, locale)}</Text>
        </Card>
      ) : null}

      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {info ? (
        <Text variant="small" accessibilityLiveRegion="polite">
          {info}
        </Text>
      ) : null}

      {/* Actions du chauffeur */}
      {role === 'driver' && live ? (
        <View style={{ gap: spacing.sm }}>
          {status === 'accepted' ? (
            <>
              <Text variant="bodyStrong">{t('mobility.driver.stepEnRoute')}</Text>
              <Button
                variant="secondary"
                label={t('mobility.driver.toPickup')}
                onPress={() => void Linking.openURL(directionsUrl(platform(), { ...ride.pickup }))}
              />
              <Button label={t('mobility.driver.arrived')} loading={arrived.isPending} onPress={() => arrived.mutate()} />
            </>
          ) : null}
          {status === 'driver_arriving' ? (
            <Card style={{ gap: spacing.md }}>
              <Text variant="bodyStrong">{t('mobility.driver.stepArrived')}</Text>
              <Text variant="heading" accessibilityRole="header">
                {t('mobility.driver.enterCode')}
              </Text>
              <Text muted>{t('mobility.driver.enterCodeBody')}</Text>
              <PinPad
                length={4}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  setCodeError(null);
                }}
                disabled={start.isPending}
                error={codeError}
              />
              <Button label={t('mobility.driver.start')} disabled={!isCompleteStartCode(code)} loading={start.isPending} onPress={() => start.mutate()} />
            </Card>
          ) : null}
          {status === 'in_progress' ? (
            <>
              <Button
                variant="secondary"
                label={t('mobility.driver.toDropoff')}
                onPress={() => void Linking.openURL(directionsUrl(platform(), { ...ride.dropoff }))}
              />
              <Button label={t('mobility.driver.complete')} loading={complete.isPending} onPress={() => complete.mutate()} />
            </>
          ) : null}
        </View>
      ) : null}

      {/* Messages rapides */}
      {live && actions('message') ? (
        <>
          <SectionTitle>{t('mobility.msg.title')}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {CODES.map((c) => (
              <Button
                key={c}
                variant="secondary"
                label={t(`mobility.msg.${c}` as MessageKey)}
                disabled={send.isPending}
                onPress={() => send.mutate(c)}
                style={{ paddingHorizontal: spacing.md }}
              />
            ))}
          </View>
          {messages.data && messages.data.items.length > 0 ? (
            <Card style={{ gap: spacing.xs }} >
              {messages.data.items.slice(-5).map((m) => (
                <Text key={m.id} variant="small" accessibilityLiveRegion="polite">
                  <Text variant="small" muted>
                    {m.mine ? t('mobility.msg.mine') : t('mobility.msg.other')}
                    {' : '}
                  </Text>
                  {t(`mobility.msg.${m.code}` as MessageKey)}
                </Text>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}

      {/* Sécurité du passager */}
      {live && role === 'rider' ? (
        <View style={{ gap: spacing.sm }}>
          {actions('share') ? (
            <>
              <Text variant="small" muted>
                {t('mobility.share.body')}
              </Text>
              <Button variant="secondary" label={t('mobility.share.button')} loading={share.isPending} onPress={() => share.mutate()} />
            </>
          ) : null}
          {actions('alert') ? <Button variant="danger" label={t('mobility.alert.button')} onPress={() => setAlerting(true)} /> : null}
        </View>
      ) : null}

      {/* Fin de course : reçu et évaluation */}
      {status === 'completed' ? (
        <>
          {receipt.data ? (
            <>
              <SectionTitle>{t('mobility.receipt.title')}</SectionTitle>
              <Card style={{ gap: spacing.xs }}>
                <Row label={t('mobility.receipt.fare')} value={formatMoney(receipt.data.fareMinor, receipt.data.currency, locale)} />
                <Row label={t('mobility.receipt.distance')} value={formatDistance(receipt.data.distanceKm, locale)} />
                <Row label={t('mobility.receipt.duration')} value={t('mobility.receipt.duration.value', { min: receipt.data.durationMin })} />
                {receipt.data.driverName ? <Row label={t('mobility.receipt.driver')} value={receipt.data.driverName} /> : null}
                {receipt.data.plate ? <Row label={t('mobility.receipt.plate')} value={receipt.data.plate} /> : null}
                <Row label={t('mobility.receipt.date')} value={new Date(receipt.data.completedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} />
                <Text variant="small" muted>
                  {t('mobility.receipt.paid')} {t('mobility.receipt.estimated')}
                </Text>
              </Card>
            </>
          ) : null}
          {rated ? (
            <Text accessibilityLiveRegion="polite">{t('mobility.rate.done')}</Text>
          ) : (
            <RatingForm
              title={t(role === 'rider' ? 'mobility.rate.riderTitle' : 'mobility.rate.driverTitle')}
              busy={rate.isPending}
              error={rate.isError ? mobilityErrorMessage(rate.error, t, locale) : null}
              onSubmit={(rating, comment) => rate.mutate({ rating, comment })}
            />
          )}
        </>
      ) : null}

      {role === 'rider' && (status === 'expired' || status === 'cancelled_by_driver' || status === 'cancelled_by_rider' || status === 'completed') ? (
        <Button variant="secondary" label={t('mobility.ride.newRide')} onPress={() => router.replace('/rides')} />
      ) : null}
      {role === 'driver' && isFinishedRide(status) ? (
        <Button variant="secondary" label={t('mobility.driver.title')} onPress={() => router.replace('/rides/driver')} />
      ) : null}

      {actions('cancel') ? <Button variant="ghost" label={t('mobility.cancel.button')} onPress={() => setCancelling(true)} /> : null}
      {actions('report') ? (
        <Button variant="ghost" label={t('mobility.ride.report')} onPress={() => openReport({ targetType: 'ride', targetId: id })} />
      ) : null}

      <CancelSheet
        visible={cancelling}
        role={role}
        busy={cancel.isPending}
        error={cancel.isError ? mobilityErrorMessage(cancel.error, t, locale) : null}
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
      <SheetModal visible={alerting} onClose={() => setAlerting(false)}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading" accessibilityRole="header">
            {t('mobility.alert.title')}
          </Text>
          <Text muted>{t('mobility.alert.body')}</Text>
          <Button variant="danger" label={t('mobility.alert.confirm')} loading={alert.isPending} onPress={() => alert.mutate()} />
          <Button variant="ghost" label={t('common.cancel')} disabled={alert.isPending} onPress={() => setAlerting(false)} />
        </View>
      </SheetModal>
    </Screen>
  );
}
