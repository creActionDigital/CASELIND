import type { RidePoint, RideVehicle } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { formatDistance, GOMA_CENTER } from '../../../places/geo';
import { TileMap } from '../../../places/TileMap';
import { checkRideSchedule, formatFareRange, isLiveRide } from '../../../mobility/logic';
import { createRide, estimateRide, fetchFavorites, fetchMyRides, rideKeys } from '../../../mobility/api';
import { mobilityErrorMessage } from '../../../mobility/errors';
import { PlaceSheet } from '../../../mobility/ui';
import { formatDateField, formatTimeField, parseLocalDateTime } from '../../../messaging/extras-logic';
import { Card, Chips, SectionTitle } from '../../../seller/ui';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Screen, Text, TextField } from '../../../ui';

type Slot = 'pickup' | 'stop' | 'dropoff';
type When = 'now' | 'later';
const VEHICLES: RideVehicle[] = ['moto', 'standard', 'confort'];

/** Commander une course : départ, arrêt facultatif, arrivée, estimation par type, maintenant ou programmée. */
export default function RidesHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const dest = useLocalSearchParams<{ destLat?: string; destLng?: string; destLabel?: string }>();
  const [points, setPoints] = useState<Record<Slot, RidePoint | null>>({ pickup: null, stop: null, dropoff: null });
  const [showStop, setShowStop] = useState(false);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [vehicle, setVehicle] = useState<RideVehicle>('standard');
  const [when, setWhen] = useState<When>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const favorites = useQuery({ queryKey: rideKeys.favorites, queryFn: fetchFavorites, retry: false });

  // Destination préremplie (depuis la carte : « Commander une course vers ce lieu »).
  useEffect(() => {
    const lat = Number(dest.destLat);
    const lng = Number(dest.destLng);
    if (dest.destLat && dest.destLng && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      setPoints((cur) => ({ ...cur, dropoff: { lat, lng, label: (dest.destLabel ?? '').slice(0, 160) || t('mobility.dropoff') } }));
      setPlanning(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appliqué une fois par destination reçue.
  }, [dest.destLat, dest.destLng, dest.destLabel]);

  useEffect(() => {
    const d = new Date(Date.now() + 3600_000);
    setDate(formatDateField(d));
    setTime(formatTimeField(d));
  }, []);

  const active = useQuery({ queryKey: rideKeys.mine('active'), queryFn: () => fetchMyRides('active'), retry: false });
  const liveRide = active.data?.items.find((r) => isLiveRide(r.status));

  const mapMarkers = (['pickup', 'stop', 'dropoff'] as const).flatMap((slot) => (points[slot] ? [{ id: slot, lat: points[slot]!.lat, lng: points[slot]!.lng, label: points[slot]!.label, selected: slot === 'dropoff' }] : []));
  const mapPoints = mapMarkers.map((m) => ({ lat: m.lat, lng: m.lng }));

  const ready = !!points.pickup && !!points.dropoff;
  const route = ready ? { pickup: points.pickup!, dropoff: points.dropoff!, ...(showStop && points.stop ? { stop: points.stop } : {}) } : null;
  const estimate = useQuery({
    queryKey: ['mobility', 'estimate', route, vehicle],
    queryFn: () => estimateRide({ ...route!, vehicle }),
    enabled: !!route,
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const order = useMutation({
    mutationFn: (scheduledAt?: string) => createRide({ ...route!, vehicle, ...(scheduledAt ? { scheduledAt } : {}) }),
    onSuccess: (ride) => router.replace({ pathname: '/rides/[rideId]', params: { rideId: ride.id } }),
    onError: (e) => setError(mobilityErrorMessage(e, t, locale)),
  });

  function submit() {
    setError(null);
    setScheduleError(null);
    if (!route) return setError(t('mobility.order.missing'));
    if (when === 'now') return order.mutate(undefined);
    const at = parseLocalDateTime(date, time);
    const check = checkRideSchedule(at, Date.now());
    if (check !== 'ok' || !at) return setScheduleError(t(`mobility.schedule.${check === 'ok' ? 'invalid' : check}` as MessageKey));
    order.mutate(at.toISOString());
  }

  const slots: { slot: Slot; label: MessageKey; icon: 'radio-button-on' | 'flag-outline' | 'ellipse-outline' }[] = [
    { slot: 'pickup', label: 'mobility.pickup', icon: 'radio-button-on' },
    ...(showStop ? [{ slot: 'stop' as const, label: 'mobility.stop' as MessageKey, icon: 'ellipse-outline' as const }] : []),
    { slot: 'dropoff', label: 'mobility.dropoff', icon: 'flag-outline' },
  ];


  const home = !planning && !points.dropoff;
  const goPlan = (dropoff: RidePoint) => {
    setPoints((cur) => ({ ...cur, dropoff }));
    setPlanning(true);
  };
  const suggestions: { key: MessageKey; icon: 'car-outline' | 'bicycle-outline' | 'key-outline' | 'people-outline' | 'construct-outline'; go: () => void }[] = [
    { key: 'mobility.sug.ride', icon: 'car-outline', go: () => setEditing('dropoff') },
    { key: 'mobility.sug.moto', icon: 'bicycle-outline', go: () => { setVehicle('moto'); setEditing('dropoff'); } },
    { key: 'mobility.sug.rental', icon: 'key-outline', go: () => router.push('/rentals') },
    { key: 'mobility.sug.carpool', icon: 'people-outline', go: () => router.push('/carpool') },
    { key: 'mobility.sug.roadside', icon: 'construct-outline', go: () => router.push('/roadside') },
  ];

  return (
    <View style={styles.root}>
    <Screen bottomSpace={home ? 0 : 88}>
      <Stack.Screen options={{ title: t('mobility.title') }} />
      {home ? null : (
        <>
          <Text variant="title" accessibilityRole="header">
            {t('mobility.order.title')}
          </Text>
          <Text muted>{t('mobility.order.intro')}</Text>
        </>
      )}

      {liveRide ? (
        <Card
          label={`${t('mobility.active.title')}, ${t(`mobility.status.${liveRide.status}` as MessageKey)}`}
          onPress={() => router.push({ pathname: '/rides/[rideId]', params: { rideId: liveRide.id } })}
          style={{ gap: spacing.xs }}
        >
          <View style={styles.line}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('mobility.active.title')}
            </Text>
            <Badge tone="accent" label={t(`mobility.status.${liveRide.status}` as MessageKey)} />
          </View>
          <Text variant="small" muted numberOfLines={1}>
            {liveRide.pickup.label} → {liveRide.dropoff.label}
          </Text>
        </Card>
      ) : null}

      {home ? (
        <>
          <View style={styles.whereRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobility.where')}
              onPress={() => setEditing('dropoff')}
              style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}
            >
              <Ionicons name="search" size={20} color={colors.primary} />
              <Text variant="bodyStrong" color={colors.textMuted}>
                {t('mobility.where')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(when === 'now' ? 'mobility.when.now' : 'mobility.when.later')}
              onPress={() => setWhen(when === 'now' ? 'later' : 'now')}
              style={[styles.pill, { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }]}
            >
              <Ionicons name="time-outline" size={18} color={colors.primary} />
              <Text variant="small" color={colors.primary} style={{ fontWeight: '700' }}>
                {t(when === 'now' ? 'mobility.when.now' : 'mobility.when.later')}
              </Text>
            </Pressable>
          </View>
          {favorites.data && favorites.data.items.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <SectionTitle>{t('mobility.saved')}</SectionTitle>
              {favorites.data.items.map((f) => (
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.label}, ${f.address}`}
                  onPress={() => goPlan({ lat: f.lat, lng: f.lng, label: f.label })}
                  style={[styles.place, { backgroundColor: colors.surface }]}
                >
                  <View style={[styles.iconBox, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name={f.kind === 'home' ? 'home-outline' : f.kind === 'work' ? 'briefcase-outline' : 'location-outline'} size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {f.label}
                    </Text>
                    <Text variant="small" muted numberOfLines={1}>
                      {f.address}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Button variant="ghost" label={t('mobility.places.add')} onPress={() => router.push('/rides/places')} />
          )}
          <SectionTitle>{t('mobility.suggestions')}</SectionTitle>
          <View style={styles.tiles}>
            {suggestions.map((x) => (
              <Pressable key={x.key} accessibilityRole="button" accessibilityLabel={t(x.key)} onPress={x.go} style={styles.tile}>
                <View style={[styles.iconBox, styles.tileIcon, { backgroundColor: colors.surface }]}>
                  <Ionicons name={x.icon} size={26} color={colors.primary} />
                </View>
                <Text variant="caption" numberOfLines={1} style={{ textAlign: 'center', fontSize: 11 }}>
                  {t(x.key)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
      <TileMap
        style={styles.map}
        fit={mapPoints.length > 0 ? mapPoints : [GOMA_CENTER]}
        fitKey={mapPoints.map((p) => `${p.lat},${p.lng}`).join('|') || 'goma'}
        markers={mapMarkers}
        line={mapPoints}
      />

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {slots.map(({ slot, label, icon }) => {
          const p = points[slot];
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={`${t(label)}: ${p ? p.label : t('mobility.choose')}`}
              onPress={() => setEditing(slot)}
              style={[styles.place, { backgroundColor: colors.surface }]}
            >
              <Ionicons name={icon} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" muted>
                  {t(label)}
                </Text>
                <Text variant="bodyStrong" numberOfLines={1} color={p ? undefined : colors.textMuted}>
                  {p ? p.label : t('mobility.choose')}
                </Text>
              </View>
              <Text variant="small" color={colors.primary}>
                {p ? t('mobility.change') : ''}
              </Text>
            </Pressable>
          );
        })}
        {showStop ? (
          <Button
            variant="ghost"
            label={t('mobility.removeStop')}
            onPress={() => {
              setShowStop(false);
              setPoints((cur) => ({ ...cur, stop: null }));
            }}
          />
        ) : (
          <Button variant="ghost" label={t('mobility.addStop')} onPress={() => setShowStop(true)} />
        )}
      </View>

      <SectionTitle>{t('mobility.pickVehicle')}</SectionTitle>
      {!route ? (
        <Text muted>{t('mobility.estimate.pick')}</Text>
      ) : estimate.isError ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {mobilityErrorMessage(estimate.error, t, locale)}
        </Text>
      ) : !estimate.data ? (
        <Text muted>{t('mobility.estimate.loading')}</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="small" muted>
            {t('mobility.estimate.route', { distance: formatDistance(estimate.data.distanceKm, locale), min: estimate.data.durationMin })}
          </Text>
          <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
            {VEHICLES.map((v) => {
              const opt = estimate.data!.options.find((o) => o.vehicle === v);
              const selected = vehicle === v;
              const range = opt ? formatFareRange(opt.fareMin, opt.fareMax, estimate.data!.currency, locale) : '—';
              return (
                <Pressable
                  key={v}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t('mobility.estimate.option', { vehicle: t(`mobility.vehicle.${v}` as MessageKey), range })}
                  onPress={() => setVehicle(v)}
                  style={[styles.option, { backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                >
                  <View style={[styles.iconBox, { backgroundColor: colors.background }]}>
                    <Ionicons name={v === 'moto' ? 'bicycle-outline' : 'car-outline'} size={26} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.line}>
                      <Text variant="bodyStrong" style={{ flex: 1 }}>{t(`mobility.vehicle.${v}` as MessageKey)}</Text>
                      <Text variant="caption" muted>
                        {t('mobility.etaMin', { min: estimate.data!.durationMin })}
                      </Text>
                    </View>
                    <Text variant="small" muted>
                      {t(`mobility.vehicle.${v}.body` as MessageKey)}
                    </Text>
                    <Text variant="bodyStrong" color={colors.primary}>{range}</Text>
                    <Text variant="caption" muted>{t('mobility.estimated')}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text variant="small" muted>
            {t('mobility.cash')} {t('mobility.disclaimer')}
          </Text>
        </View>
      )}

      <Chips<When>
        scroll={false}
        options={[
          { value: 'now', label: t('mobility.when.now') },
          { value: 'later', label: t('mobility.when.later') },
        ]}
        value={when}
        onChange={setWhen}
      />
      {when === 'later' ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="small" muted>
            {t('mobility.schedule.hint')}
          </Text>
          <TextField label={t('mobility.schedule.date')} value={date} onChangeText={setDate} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
          <TextField label={t('mobility.schedule.time')} value={time} onChangeText={setTime} placeholder="09:30" keyboardType="numbers-and-punctuation" autoCorrect={false} />
          {scheduleError ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
              {scheduleError}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
        </>
      )}

      <View style={{ gap: spacing.xs, marginTop: spacing.lg }}>
        <Button variant="secondary" label={t('mobility.link.history')} onPress={() => router.push('/rides/history')} />
        <Button variant="secondary" label={t('mobility.link.places')} onPress={() => router.push('/rides/places')} />
        <Button variant="secondary" label={t('mobility.link.contacts')} onPress={() => router.push('/rides/contacts')} />
        <Button variant="secondary" label={t('mobility.link.driver')} onPress={() => router.push('/rides/driver')} />
      </View>

      <PlaceSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onPick={(p) => {
          if (editing === 'dropoff') goPlan(p);
          else if (editing) setPoints((cur) => ({ ...cur, [editing]: p }));
          setEditing(null);
        }}
      />
    </Screen>
    {home ? null : (
      <View style={[styles.bar, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Button
        label={t(when === 'now' ? 'mobility.order.now' : 'mobility.order.schedule')}
        disabled={!route || !estimate.data}
        loading={order.isPending}
        onPress={submit}
      />
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.lg },
  iconBox: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  tile: { flex: 1, alignItems: 'center', gap: spacing.xs, minHeight: TOUCH },
  tileIcon: { width: 56, height: 56, borderRadius: radius.lg },
  map: { height: 220, borderRadius: radius.lg, marginTop: spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  place: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
  option: { minHeight: TOUCH + 16, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1.5, padding: spacing.md },
});
