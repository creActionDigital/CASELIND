import type { CarpoolBooking, CarpoolTrip } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { bookCarpool, carpoolBookingStep, carpoolTripStep, extraKeys, fetchCarpoolTrip, rateCarpool } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { bookingDriverActions, driverActions, passengerActions } from '../../../mobility/extra/logic';
import { ErrorLine, formatWhen, StarPicker } from '../../../mobility/extra/ui';
import { Row } from '../../../mobility/ui';
import { openReport } from '../../../report/open-report';
import { TileMap } from '../../../places/TileMap';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { radius, spacing } from '../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/** Détail d’un trajet : carte, réservation (passager), demandes et étapes (conducteur), évaluation après le trajet. */
export default function CarpoolTripScreen() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: extraKeys.carpoolTrip(id), queryFn: () => fetchCarpoolTrip(id), enabled: !!id, retry: false });
  const [seats, setSeats] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: extraKeys.carpoolAll });
  };
  const fail = (e: unknown) => setError(extraErrorMessage(e, t, locale));
  const book = useMutation({ mutationFn: () => bookCarpool(id, Number(seats)), onSuccess: refresh, onError: fail });
  const bookingStep = useMutation({ mutationFn: (a: { id: string; step: 'accept' | 'decline' | 'cancel' }) => carpoolBookingStep(a.id, a.step), onSuccess: refresh, onError: fail });
  const tripStep = useMutation({ mutationFn: (step: 'depart' | 'complete' | 'cancel') => carpoolTripStep(id, step), onSuccess: refresh, onError: fail });
  const rate = useMutation({ mutationFn: (a: { userId: string; rating: number }) => rateCarpool(id, a.userId, a.rating), onSuccess: refresh, onError: fail });

  const title = <Stack.Screen options={{ title: t('carpool.detail.title') }} />;
  if (q.isPending) return <>{title}<Loading /></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  const trip: CarpoolTrip = q.data;
  const isDriver = trip.role === 'driver';
  const pa = passengerActions({ role: trip.role, status: trip.status, myBookingStatus: trip.myBooking?.status ?? null });
  const da = driverActions(trip.status);
  const money = (n: number) => (n === 0 ? t('carpool.free') : formatMoney(n, trip.currency, locale));
  const confirm = (message: MessageKey, onPress: () => void, label: MessageKey) =>
    alertConfirm(t(message), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t(label), style: 'destructive', onPress },
    ]);
  const seatOptions = Array.from({ length: Math.min(4, Math.max(1, trip.seatsFree)) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

  const bookingLine = (b: CarpoolBooking) => {
    const a = bookingDriverActions(b.status, trip.status);
    return (
      <Card key={b.id} style={{ gap: spacing.xs, marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {b.passenger.displayName} · {t('carpool.seatsAsked', { n: b.seats })}
          </Text>
          <Badge tone={b.status === 'accepted' ? 'primary' : 'neutral'} label={t(`carpool.booking.${b.status}` as MessageKey)} />
        </View>
        {a.accept || a.decline || a.cancel ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {a.accept ? <Button label={t('carpool.accept')} loading={bookingStep.isPending} onPress={() => bookingStep.mutate({ id: b.id, step: 'accept' })} /> : null}
            {a.decline ? <Button variant="secondary" label={t('carpool.decline')} onPress={() => bookingStep.mutate({ id: b.id, step: 'decline' })} /> : null}
            {a.cancel ? <Button variant="danger" label={t('carpool.cancelBooking')} onPress={() => confirm('carpool.cancelBooking.confirm', () => bookingStep.mutate({ id: b.id, step: 'cancel' }), 'carpool.cancelBooking')} /> : null}
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <Screen>
      {title}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {trip.origin.label} → {trip.destination.label}
        </Text>
        <Badge tone="accent" label={t(`carpool.status.${trip.status}` as MessageKey)} />
      </View>
      <TileMap
        style={{ height: 200, borderRadius: radius.lg }}
        fit={[trip.origin, trip.destination]}
        fitKey={`${trip.id}:${trip.exact}`}
        markers={[
          { id: 'o', lat: trip.origin.lat, lng: trip.origin.lng, label: trip.origin.label },
          { id: 'd', lat: trip.destination.lat, lng: trip.destination.lng, label: trip.destination.label, selected: true },
        ]}
        line={[trip.origin, trip.destination]}
      />
      {!trip.exact ? (
        <Text variant="small" muted>
          {t('carpool.rounded')}
        </Text>
      ) : null}

      <Card style={{ gap: spacing.xs }}>
        <Row label={t('carpool.when')} value={formatWhen(trip.departsAt, locale)} />
        <Row label={t('carpool.pricePerSeat')} value={money(trip.pricePerSeatMinor)} />
        <Row label={t('carpool.seats')} value={`${trip.seatsFree} / ${trip.seatsTotal}`} />
        <Row label={t('carpool.driver')} value={`${trip.driver.displayName}${trip.driver.ratingAvg !== null ? ` · ${trip.driver.ratingAvg.toFixed(1)}/5 (${trip.driver.ratingCount})` : ''}`} />
        {trip.vehicleLabel ? <Row label={t('carpool.vehicle')} value={trip.vehicleLabel} /> : null}
        {trip.note ? <Row label={t('carpool.note')} value={trip.note} /> : null}
      </Card>
      <Text variant="small" muted>
        {t('carpool.cash')}
      </Text>
      <ErrorLine message={error} />

      {pa.book ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('carpool.book.title')}</SectionTitle>
          <Chips<string> options={seatOptions} value={seats} onChange={setSeats} scroll={false} />
          <Button label={t('carpool.book.go')} loading={book.isPending} onPress={() => book.mutate()} />
        </View>
      ) : null}
      {trip.myBooking ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('carpool.myBooking')}</SectionTitle>
          <Badge tone="primary" label={`${t(`carpool.booking.${trip.myBooking.status}` as MessageKey)} · ${t('carpool.seatsAsked', { n: trip.myBooking.seats })}`} />
          {pa.cancelBooking ? (
            <Button variant="danger" label={t('carpool.cancelBooking')} onPress={() => confirm('carpool.cancelBooking.confirm', () => bookingStep.mutate({ id: trip.myBooking!.id, step: 'cancel' }), 'carpool.cancelBooking')} />
          ) : null}
        </View>
      ) : null}

      {isDriver ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('carpool.requests')}</SectionTitle>
          {trip.bookings.length === 0 ? <Text muted>{t('carpool.requests.empty')}</Text> : trip.bookings.map(bookingLine)}
          {da.depart ? <Button label={t('carpool.depart')} loading={tripStep.isPending} onPress={() => tripStep.mutate('depart')} /> : null}
          {da.complete ? <Button label={t('carpool.complete')} loading={tripStep.isPending} onPress={() => tripStep.mutate('complete')} /> : null}
          {da.cancel ? <Button variant="danger" label={t('carpool.cancelTrip')} onPress={() => confirm('carpool.cancelTrip.confirm', () => tripStep.mutate('cancel'), 'carpool.cancelTrip')} /> : null}
        </View>
      ) : null}

      {trip.toRate.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t('carpool.rate.title')}</SectionTitle>
          {trip.toRate.map((p) => (
            <StarPicker key={p.id} label={t('carpool.rate.person', { name: p.displayName })} busy={rate.isPending} onPick={(rating) => rate.mutate({ userId: p.id, rating })} />
          ))}
        </View>
      ) : null}

      {trip.role !== 'driver' && trip.note ? (
        <Button variant="ghost" label={t('carpool.report')} onPress={() => openReport({ targetType: 'carpool_trip', targetId: trip.id })} />
      ) : null}
    </Screen>
  );
}
