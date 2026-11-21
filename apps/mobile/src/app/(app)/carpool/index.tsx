import type { RidePoint } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../i18n';
import { extraErrorMessage } from '../../../mobility/extra/errors';
import { extraKeys, searchCarpool } from '../../../mobility/extra/api';
import { isDay } from '../../../mobility/extra/logic';
import { formatWhen, PlaceRow } from '../../../mobility/extra/ui';
import { PlaceSheet } from '../../../mobility/ui';
import { formatMoney } from '../../../shop/format';
import { Card } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, Screen, Text, TextField } from '../../../ui';

type Slot = 'origin' | 'destination';

/** Covoiturage : chercher un trajet ouvert près d’un départ (et d’une arrivée), un jour donné. Espèces entre les parties. */
export default function CarpoolHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [points, setPoints] = useState<Record<Slot, RidePoint | null>>({ origin: null, destination: null });
  const [editing, setEditing] = useState<Slot | null>(null);
  const [date, setDate] = useState('');
  const [submitted, setSubmitted] = useState<Record<string, string | number | undefined> | null>(null);
  const [dateError, setDateError] = useState(false);

  const results = useInfiniteQuery({
    queryKey: extraKeys.carpoolSearch(JSON.stringify(submitted)),
    queryFn: ({ pageParam }) => searchCarpool({ ...(submitted ?? {}), cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });

  function search() {
    setDateError(false);
    if (!points.origin) return;
    if (date.trim() && !isDay(date)) return setDateError(true);
    setSubmitted({
      originLat: points.origin.lat,
      originLng: points.origin.lng,
      destLat: points.destination?.lat,
      destLng: points.destination?.lng,
      date: date.trim() || undefined,
    });
  }

  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('carpool.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('carpool.search.title')}
      </Text>
      <Text muted>{t('carpool.intro')}</Text>
      <View style={{ gap: spacing.sm }}>
        <PlaceRow label={t('carpool.origin')} point={points.origin} icon="radio-button-on" onPress={() => setEditing('origin')} />
        <PlaceRow label={t('carpool.destination')} point={points.destination} icon="flag-outline" onPress={() => setEditing('destination')} />
        <TextField label={t('carpool.date')} value={date} onChangeText={setDate} maxLength={10} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        {dateError ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {t('extra.error.invalid_date')}
          </Text>
        ) : null}
        <Button label={t('carpool.search.go')} disabled={!points.origin} loading={results.isFetching && items.length === 0} onPress={search} />
      </View>

      {results.isError ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {extraErrorMessage(results.error, t, locale)}
        </Text>
      ) : null}
      {results.isSuccess && items.length === 0 ? <EmptyState icon="car-outline" title={t('carpool.empty')} body={t('carpool.empty.body')} /> : null}
      {items.length > 0 && !submitted ? (
        <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.md }}>
          {t('mb.carpool.upcoming')}
        </Text>
      ) : null}
      {results.isPending ? <Text muted>{t('common.loading')}</Text> : null}
      {items.map((trip) => (
        <Card
          key={trip.id}
          label={`${trip.origin.label} → ${trip.destination.label}`}
          onPress={() => router.push(`/carpool/${trip.id}` as never)}
          style={{ gap: spacing.xs, marginTop: spacing.sm }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {trip.origin.label} → {trip.destination.label}
            </Text>
            <Badge tone="accent" label={trip.pricePerSeatMinor === 0 ? t('carpool.free') : formatMoney(trip.pricePerSeatMinor, trip.currency, locale)} />
          </View>
          <Text variant="small" muted>
            {formatWhen(trip.departsAt, locale)} · {t('carpool.seatsLeft', { n: trip.seatsFree })}
          </Text>
          <Text variant="small" muted>
            {trip.driver.displayName}
            {trip.driver.ratingAvg !== null ? ` · ${trip.driver.ratingAvg.toFixed(1)}/5 (${trip.driver.ratingCount})` : ''}
          </Text>
        </Card>
      ))}
      {results.hasNextPage ? <Button variant="secondary" label={t('extra.more')} loading={results.isFetchingNextPage} onPress={() => void results.fetchNextPage()} /> : null}

      <View style={{ gap: spacing.xs, marginTop: spacing.lg }}>
        <Button variant="secondary" label={t('carpool.link.new')} onPress={() => router.push('/carpool/new' as never)} />
        <Button variant="secondary" label={t('carpool.link.mine')} onPress={() => router.push('/carpool/mine' as never)} />
      </View>
      <Text variant="small" muted>
        {t('carpool.cash')}
      </Text>

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
