import type { RidePoint, RideVehicle } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { formatDistance } from '../../../places/geo';
import { checkRideSchedule, formatFareRange, isLiveRide } from '../../../mobility/logic';
import { createRide, estimateRide, fetchMyRides, rideKeys } from '../../../mobility/api';
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
  const [points, setPoints] = useState<Record<Slot, RidePoint | null>>({ pickup: null, stop: null, dropoff: null });
  const [showStop, setShowStop] = useState(false);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [vehicle, setVehicle] = useState<RideVehicle>('standard');
  const [when, setWhen] = useState<When>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = new Date(Date.now() + 3600_000);
    setDate(formatDateField(d));
    setTime(formatTimeField(d));
  }, []);

  const active = useQuery({ queryKey: rideKeys.mine('active'), queryFn: () => fetchMyRides('active'), retry: false });
  const liveRide = active.data?.items.find((r) => isLiveRide(r.status));

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


  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('mobility.order.title')}
      </Text>
      <Text muted>{t('mobility.order.intro')}</Text>

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

      <SectionTitle>{t('mobility.estimate.title')}</SectionTitle>
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
                  <Ionicons name={v === 'moto' ? 'bicycle-outline' : 'car-outline'} size={26} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{t(`mobility.vehicle.${v}` as MessageKey)}</Text>
                    <Text variant="small" muted>
                      {t(`mobility.vehicle.${v}.body` as MessageKey)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="bodyStrong">{range}</Text>
                    <Text variant="caption" muted>
                      {t('mobility.estimated')}
                    </Text>
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
      <Button
        label={t(when === 'now' ? 'mobility.order.now' : 'mobility.order.schedule')}
        disabled={!route || !estimate.data}
        loading={order.isPending}
        onPress={submit}
      />

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
          if (editing) setPoints((cur) => ({ ...cur, [editing]: p }));
          setEditing(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  place: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
  option: { minHeight: TOUCH + 16, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1.5, padding: spacing.md },
});
