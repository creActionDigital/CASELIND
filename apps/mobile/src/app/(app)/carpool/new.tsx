import type { RidePoint } from '@caselind/contracts';
import { CARPOOL_SEATS_MAX } from '@caselind/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDateField, formatTimeField, parseLocalDateTime } from '../../../messaging/extras-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { carpoolQuote, createCarpoolTrip } from '../../../mobility/extra/api';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { checkDeparture, parsePriceMinor } from '../../../mobility/extra/logic';
import { ErrorLine, PlaceRow } from '../../../mobility/extra/ui';
import { PlaceSheet } from '../../../mobility/ui';
import { Chips } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { Button, Screen, Text, TextField } from '../../../ui';

type Slot = 'origin' | 'destination';
const SEATS = Array.from({ length: CARPOOL_SEATS_MAX }, (_, i) => i + 1);

/** Proposer un trajet : réservé aux chauffeurs approuvés ; le prix par place est plafonné par le serveur (2 fois l’estimation). */
export default function NewCarpoolTrip() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [points, setPoints] = useState<Record<Slot, RidePoint | null>>({ origin: null, destination: null });
  const [editing, setEditing] = useState<Slot | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState('3');
  const [price, setPrice] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = new Date(Date.now() + 3 * 3600_000);
    setDate(formatDateField(d));
    setTime(formatTimeField(d));
  }, []);

  const ready = points.origin && points.destination;
  const quote = useQuery({
    queryKey: ['carpool', 'quote', points.origin?.lat, points.origin?.lng, points.destination?.lat, points.destination?.lng],
    queryFn: () => carpoolQuote({ origin: points.origin!, destination: points.destination! }),
    enabled: !!ready,
    retry: false,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const at = parseLocalDateTime(date, time);
      const check = checkDeparture(at, Date.now());
      if (check !== 'ok' || !at) throw new Error(`departure:${check}`);
      const priceMinor = parsePriceMinor(price);
      if (priceMinor === null) throw new Error('price');
      return createCarpoolTrip({
        origin: points.origin!,
        destination: points.destination!,
        departsAt: at.toISOString(),
        seatsTotal: Number(seats),
        pricePerSeatMinor: priceMinor,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(vehicle.trim() ? { vehicleLabel: vehicle.trim() } : {}),
      });
    },
    onSuccess: (trip) => router.replace(`/carpool/${trip.id}` as never),
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (m.startsWith('departure:')) setError(t(`carpool.departure.${m.slice(10)}` as MessageKey));
      else if (m === 'price') setError(t('carpool.price.invalid'));
      else setError(extraErrorMessage(e, t, locale));
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('carpool.new.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('carpool.new.title')}
      </Text>
      <Text muted>{t('carpool.new.intro')}</Text>
      <View style={{ gap: spacing.sm }}>
        <PlaceRow label={t('carpool.origin')} point={points.origin} icon="radio-button-on" onPress={() => setEditing('origin')} />
        <PlaceRow label={t('carpool.new.destination')} point={points.destination} icon="flag-outline" onPress={() => setEditing('destination')} />
        <TextField label={t('carpool.date')} value={date} onChangeText={setDate} maxLength={10} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        <TextField label={t('carpool.time')} value={time} onChangeText={setTime} maxLength={5} placeholder="09:30" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        <Text variant="bodyStrong">{t('carpool.seats')}</Text>
        <Chips<string> options={SEATS.map((n) => ({ value: String(n), label: String(n) }))} value={seats} onChange={setSeats} />
        {quote.data ? (
          <Text variant="small" muted>
            {t('carpool.quote', { fare: formatMoney(quote.data.estimatedFareMinor, quote.data.currency, locale), max: formatMoney(quote.data.maxPricePerSeatMinor, quote.data.currency, locale) })}
          </Text>
        ) : quote.isError ? (
          <ErrorLine message={extraErrorMessage(quote.error, t, locale)} />
        ) : null}
        <TextField label={t('carpool.price')} value={price} onChangeText={setPrice} placeholder="5,00" keyboardType="decimal-pad" />
        <TextField label={t('carpool.vehicle')} value={vehicle} onChangeText={setVehicle} maxLength={60} />
        <TextField label={t('carpool.note')} value={note} onChangeText={setNote} maxLength={200} multiline />
        <Text variant="small" muted>
          {t('carpool.note.public')}
        </Text>
        <ErrorLine message={error} />
        <Button
          label={t('carpool.new.submit')}
          disabled={!ready || price.trim() === ''}
          loading={create.isPending}
          onPress={() => {
            setError(null);
            create.mutate();
          }}
        />
        <Text variant="small" muted>
          {t('carpool.cash')}
        </Text>
      </View>
      <PlaceSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onPick={(p) => {
          if (editing) setPoints((cur) => ({ ...cur, [editing]: p }));
          setEditing(null);
        }}
      />
    </Screen>
  );
}
