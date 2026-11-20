import type { CourierRequest, CourierRequestKind, CourierRequestSize, RidePoint } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { courierKeys, createCourierRequest, estimateCourier, fetchMyCourierRequests } from '../../../courier/api';
import { courierErrorMessage } from '../../../courier/errors';
import { isLiveCourier, isRequestReady, needsSize } from '../../../courier/logic';
import { checkSlot, formatSlot } from '../../../delivery/schedule-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { PlaceSheet } from '../../../mobility/ui';
import { formatDistance, GOMA_CENTER } from '../../../places/geo';
import { TileMap } from '../../../places/TileMap';
import { Card, Chips, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Screen, Text, TextField } from '../../../ui';

type Slot = 'pickup' | 'dropoff';
const SIZES: CourierRequestSize[] = ['small', 'medium', 'large'];

/** Coursier à la demande : un colis ou un document d'un point à un autre, tarif estimé par le serveur, espèces au coursier. */
export default function CourierHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [kind, setKind] = useState<CourierRequestKind>('parcel');
  const [size, setSize] = useState<CourierRequestSize | null>('small');
  const [points, setPoints] = useState<Record<Slot, RidePoint | null>>({ pickup: null, dropoff: null });
  const [editing, setEditing] = useState<Slot | null>(null);
  const [note, setNote] = useState('');
  const [later, setLater] = useState(false);
  const [slotText, setSlotText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery({ queryKey: courierKeys.mine('all'), queryFn: () => fetchMyCourierRequests('all'), retry: false });

  const markers = (['pickup', 'dropoff'] as const).flatMap((s) => (points[s] ? [{ id: s, lat: points[s]!.lat, lng: points[s]!.lng, label: points[s]!.label, selected: s === 'dropoff' }] : []));
  const mapPoints = markers.map((m) => ({ lat: m.lat, lng: m.lng }));

  const draft = { kind, size: needsSize(kind) ? size : null, pickup: points.pickup, dropoff: points.dropoff };
  const ready = isRequestReady(draft);
  const route = ready ? { kind, ...(needsSize(kind) ? { size: size! } : {}), pickup: points.pickup!, dropoff: points.dropoff! } : null;
  const estimate = useQuery({
    queryKey: ['courier', 'estimate', route],
    queryFn: () => estimateCourier(route!),
    enabled: !!route,
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const create = useMutation({
    mutationFn: (scheduledFor?: string) => createCourierRequest({ ...route!, ...(note.trim() ? { note: note.trim() } : {}), ...(scheduledFor ? { scheduledFor } : {}) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: courierKeys.all });
      router.replace({ pathname: '/courier/[id]', params: { id: r.id } });
    },
    onError: (e) => setError(courierErrorMessage(e, t, locale)),
  });

  function submit() {
    setError(null);
    if (!route) return setError(t('courier.new.missing'));
    if (!later) return create.mutate(undefined);
    const slot = checkSlot(slotText);
    if (!slot.ok) return setError(t(`courier.slot.${slot.reason}` as MessageKey));
    create.mutate(slot.iso);
  }

  const live = (mine.data?.items ?? []).filter((r) => isLiveCourier(r.status));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('courier.title') }} />
      <Text variant="title" accessibilityRole="header">
        {t('courier.new.title')}
      </Text>
      <Text muted>{t('courier.new.intro')}</Text>

      {live.length > 0 ? (
        <>
          <SectionTitle>{t('courier.mine.title')}</SectionTitle>
          {live.map((r) => (
            <RequestCard key={r.id} r={r} onPress={() => router.push({ pathname: '/courier/[id]', params: { id: r.id } })} />
          ))}
        </>
      ) : null}

      <Chips<CourierRequestKind>
        scroll={false}
        options={[
          { value: 'parcel', label: t('courier.kind.parcel') },
          { value: 'document', label: t('courier.kind.document') },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setSize(k === 'parcel' ? (size ?? 'small') : null);
        }}
      />
      {needsSize(kind) ? (
        <Chips<CourierRequestSize>
          scroll={false}
          options={SIZES.map((s) => ({ value: s, label: t(`courier.size.${s}` as MessageKey) }))}
          value={size ?? 'small'}
          onChange={setSize}
        />
      ) : null}

      <TileMap
        style={styles.map}
        fit={mapPoints.length > 0 ? mapPoints : [GOMA_CENTER]}
        fitKey={mapPoints.map((p) => `${p.lat},${p.lng}`).join('|') || 'goma'}
        markers={markers}
        line={mapPoints}
      />

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {(['pickup', 'dropoff'] as const).map((slot) => {
          const p = points[slot];
          const label: MessageKey = slot === 'pickup' ? 'mobility.pickup' : 'mobility.dropoff';
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={`${t(label)}: ${p ? p.label : t('mobility.choose')}`}
              onPress={() => setEditing(slot)}
              style={[styles.place, { backgroundColor: colors.surface }]}
            >
              <Ionicons name={slot === 'pickup' ? 'radio-button-on' : 'flag-outline'} size={22} color={colors.primary} />
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
      </View>

      <TextField label={t('courier.new.note')} hint={t('courier.new.noteHint')} value={note} onChangeText={setNote} maxLength={300} multiline />

      <SectionTitle>{t('courier.estimate.title')}</SectionTitle>
      {!route ? (
        <Text muted>{t('courier.estimate.pick')}</Text>
      ) : estimate.isError ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {courierErrorMessage(estimate.error, t, locale)}
        </Text>
      ) : !estimate.data ? (
        <Text muted>{t('courier.estimate.loading')}</Text>
      ) : (
        <View style={{ gap: spacing.xs }}>
          <Text variant="heading">{formatMoney(estimate.data.feeMinor, estimate.data.currency, locale)}</Text>
          <Text variant="small" muted>
            {t('courier.estimate.route', { distance: formatDistance(estimate.data.distanceKm, locale), min: estimate.data.durationMin })}
          </Text>
          <Text variant="small" muted>
            {t('courier.cash')}
          </Text>
        </View>
      )}

      <Chips<'now' | 'later'>
        scroll={false}
        options={[
          { value: 'now', label: t('courier.when.now') },
          { value: 'later', label: t('courier.when.later') },
        ]}
        value={later ? 'later' : 'now'}
        onChange={(v) => setLater(v === 'later')}
      />
      {later ? <TextField label={t('courier.slot.field')} hint={t('courier.slot.hint')} value={slotText} onChangeText={setSlotText} maxLength={16} placeholder="2026-12-24 09:30" keyboardType="numbers-and-punctuation" autoCorrect={false} /> : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t(later ? 'courier.new.schedule' : 'courier.new.send')} disabled={!route || !estimate.data} loading={create.isPending} onPress={submit} />

      <View style={{ gap: spacing.xs, marginTop: spacing.lg }}>
        <Button variant="secondary" label={t('courier.link.available')} onPress={() => router.push('/courier/available')} />
        <Button variant="secondary" label={t('courier.link.route')} onPress={() => router.push('/courier/route')} />
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

/** Carte d'une demande (liste du demandeur). */
function RequestCard({ r, onPress }: { r: CourierRequest; onPress: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Card label={`${t(`courier.kind.${r.kind}` as MessageKey)}, ${t(`courier.status.${r.status}` as MessageKey)}`} onPress={onPress} style={{ gap: spacing.xs }}>
      <View style={styles.line}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t(`courier.kind.${r.kind}` as MessageKey)}
        </Text>
        <Badge tone="accent" label={t(`courier.status.${r.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted numberOfLines={1}>
        {r.pickup.label} → {r.dropoff.label}
      </Text>
      <Text variant="small" muted>
        {formatMoney(r.feeMinor, r.currency, locale)}
        {r.scheduledFor ? ` · ${t('courier.slot.at', { when: formatSlot(r.scheduledFor, locale) })}` : ''}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  map: { height: 220, borderRadius: radius.lg, marginTop: spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  place: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
});
