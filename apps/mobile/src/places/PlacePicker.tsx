import type { RidePoint } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { fetchFavorites, rideKeys } from '../mobility/api';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { fetchPlaces } from './api';
import { getDevicePosition } from './device-location';
import { GOMA_CENTER, roundCoordinate, type LatLng } from './geo';
import { labelForPoint, matchSaved, toRidePoint, type PickedPlace } from './picker-logic';
import { loadRecentPlaces, pushRecentPlace } from './recents';
import { TileMap } from './TileMap';

type Icon = keyof typeof Ionicons.glyphMap;

/**
 * Sélecteur de lieu à la Uber : recherche (récents, favoris, lieux et boutiques), « ma position » et « choisir sur la carte »
 * avec épingle fixe. Aucune saisie de coordonnées.
 */
export function PlacePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (p: RidePoint) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recents, setRecents] = useState<PickedPlace[]>([]);
  const favorites = useQuery({ queryKey: rideKeys.favorites, queryFn: fetchFavorites, enabled: visible, retry: false });

  useEffect(() => {
    if (visible) void loadRecentPlaces().then(setRecents);
  }, [visible]);
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const remote = useQuery({
    queryKey: ['place-picker', dq],
    queryFn: () => fetchPlaces({ ...GOMA_CENTER, radiusKm: 25, q: dq }),
    enabled: visible && dq.length >= 2,
    retry: false,
  });

  const saved = useMemo<(PickedPlace & { icon: Icon })[]>(
    () => [
      ...(favorites.data?.items ?? []).map((f) => ({ lat: f.lat, lng: f.lng, label: f.label, address: f.address, icon: (f.kind === 'home' ? 'home-outline' : f.kind === 'work' ? 'briefcase-outline' : 'star-outline') as Icon })),
      ...recents.map((r) => ({ ...r, icon: 'time-outline' as Icon })),
    ],
    [favorites.data, recents],
  );
  const shownSaved = matchSaved(saved, q);
  const found = (remote.data?.items ?? []).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.label ?? p.name, address: [p.name, p.address ?? p.city].filter(Boolean).join(' · ') }));

  function done(p: PickedPlace) {
    setNote(null);
    setQ('');
    setMapOpen(false);
    void pushRecentPlace({ lat: roundCoordinate(p.lat), lng: roundCoordinate(p.lng), label: p.label, address: p.address });
    onPick(toRidePoint(p));
  }
  async function useDevice() {
    setLocating(true);
    setNote(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) return done({ ...r.position, label: t('mobility.place.deviceLabel') });
    setNote(t(r.reason === 'denied' ? 'mobility.place.denied' : 'mobility.place.unavailable'));
  }

  return (
    <>
      <SheetModal visible={visible && !mapOpen} onClose={onClose}>
        <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.sm }}>
          {t('mobility.place.title')}
        </Text>
        <TextField label={t('mobility.place.search')} value={q} onChangeText={setQ} placeholder={t('mobility.place.searchHint')} maxLength={120} autoCorrect={false} returnKeyType="search" />
        <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs }}>
          <PlaceRow icon="locate-outline" title={locating ? t('places.locating') : t('mobility.place.device')} onPress={() => void useDevice()} colors={colors} accent />
          <PlaceRow icon="map-outline" title={t('mobility.place.onMap')} onPress={() => setMapOpen(true)} colors={colors} accent />
          {note ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
              {note}
            </Text>
          ) : null}
          {shownSaved.map((s, i) => (
            <PlaceRow key={`s${i}`} icon={s.icon} title={s.label} subtitle={s.address} onPress={() => done(s)} colors={colors} />
          ))}
          {found.map((f) => (
            <PlaceRow key={f.id} icon="location-outline" title={f.label} subtitle={f.address} onPress={() => done(f)} colors={colors} />
          ))}
          {dq.length >= 2 && !remote.isFetching && found.length === 0 && shownSaved.length === 0 ? (
            <Text variant="small" muted style={{ paddingVertical: spacing.sm }}>
              {t('mobility.place.none')}
            </Text>
          ) : null}
        </ScrollView>
        <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
      </SheetModal>
      {visible && mapOpen ? <MapPick known={[...saved, ...found]} onBack={() => setMapOpen(false)} onDone={done} /> : null}
    </>
  );
}

function PlaceRow({ icon, title, subtitle, onPress, colors, accent }: { icon: Icon; title: string; subtitle?: string; onPress: () => void; colors: ReturnType<typeof useTheme>['colors']; accent?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed || accent ? colors.primarySoft : colors.surfaceAlt }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1} color={accent ? colors.primary : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" muted numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Carte plein écran : épingle fixe au centre, on déplace la carte ; le nom vient du lieu connu le plus proche. */
function MapPick({ known, onBack, onDone }: { known: readonly PickedPlace[]; onBack: () => void; onDone: (p: PickedPlace) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [start, setStart] = useState<LatLng>(GOMA_CENTER);
  const [tick, setTick] = useState(0);
  const [center, setCenter] = useState<LatLng>(GOMA_CENTER);
  const [dc, setDc] = useState<LatLng>(GOMA_CENTER);
  const [name, setName] = useState<string | null>(null); // nom saisi par l'utilisateur ; sinon proposé automatiquement

  useEffect(() => {
    const id = setTimeout(() => setDc(center), 400);
    return () => clearTimeout(id);
  }, [center]);
  const near = useQuery({
    queryKey: ['place-picker-near', roundCoordinate(dc.lat), roundCoordinate(dc.lng)],
    queryFn: () => fetchPlaces({ ...dc, radiusKm: 1 }),
    retry: false,
  });
  const nearKnown = (near.data?.items ?? []).map((p) => ({ lat: p.lat, lng: p.lng, label: p.label ?? p.name }));
  const auto = labelForPoint(center, [...nearKnown, ...known], t('mobility.place.mapPoint'));
  const shown = name ?? auto;

  async function locate() {
    const r = await getDevicePosition();
    if (r.ok) {
      setStart(r.position);
      setTick((n) => n + 1);
      setName(null);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onBack}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('mobility.place.back')} onPress={onBack} hitSlop={8} style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text variant="heading" accessibilityRole="header">
            {t('mobility.place.onMap')}
          </Text>
        </View>
        <TileMap style={{ flex: 1 }} fit={[start]} fitKey={`pick-${tick}`} markers={[]} centerPin onCenterChange={setCenter} onLocate={() => void locate()} />
        <View style={[styles.foot, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('mobility.place.moveHint')}
          </Text>
          <TextField label={t('mobility.place.label')} value={shown} onChangeText={setName} maxLength={160} />
          <Button label={t('mobility.place.validate')} disabled={!shown.trim()} onPress={() => onDone({ ...center, label: shown.trim() })} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  back: { minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  foot: { padding: spacing.md, gap: spacing.sm },
});
