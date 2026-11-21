import { Ionicons } from '@expo/vector-icons';
import { orgKindSchema, type Place } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchPlaces } from '../../../places/api';
import { getDevicePosition } from '../../../places/device-location';
import {
  DEFAULT_RADIUS_KM,
  GOMA_CENTER,
  RADII_KM,
  directionsUrl,
  formatDistance,
  roundCoordinate,
  type LatLng,
  type MapsPlatform,
} from '../../../places/geo';
import { placeHref } from '../../../places/kinds';
import { TileMap } from '../../../places/TileMap';
import { radiusPoints } from '../../../places/tiles';
import { useDebouncedValue } from '../../../search/api';
import { Chips } from '../../../seller/ui';
import { brandAccent, radius, spacing, TAB_BAR_SPACE, TOUCH } from '../../../theme/tokens';
import { ServiceTile, SkeletonList } from '../../../ui/premium';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Button, EmptyState, ErrorState, Text } from '../../../ui';

// Catégories demandées en premier (boutiques, restaurants, pharmacies, stations-service), puis les autres.
const FIRST = ['shop', 'restaurant', 'pharmacy', 'fuel_station'] as const;
const KINDS = ['', ...FIRST, ...orgKindSchema.options.filter((k) => !(FIRST as readonly string[]).includes(k))] as const;
type KindFilter = (typeof KINDS)[number];

const platform: MapsPlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

/** Carte plein écran (comme une application de transport) : barre de recherche flottante, repères, panneau des lieux en bas. */
export default function Maps() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const router = useRouter();
  // La position reste en mémoire de l'écran : jamais persistée, envoyée seulement en paramètres de requête.
  const [origin, setOrigin] = useState<{ point: LatLng; device: boolean }>({ point: GOMA_CENTER, device: false });
  const [locError, setLocError] = useState<'denied' | 'unavailable' | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [kind, setKind] = useState<KindFilter>('');
  const [text, setText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = useDebouncedValue(text.trim());
  const listRef = useRef<FlatList<Place>>(null);

  const lat = roundCoordinate(origin.point.lat);
  const lng = roundCoordinate(origin.point.lng);
  const query = useInfiniteQuery({
    queryKey: ['places', lat, lng, radiusKm, kind, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPlaces({ lat, lng, radiusKm, kind: kind || undefined, q }, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    gcTime: 60_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // Le lieu choisi sur la carte passe en tête du panneau.
  const ordered = useMemo(() => (selectedId ? [...items].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)) : items), [items, selectedId]);
  const markers = useMemo(() => items.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, selected: p.id === selectedId })), [items, selectedId]);
  const fit = useMemo(() => radiusPoints(origin.point, radiusKm), [origin.point, radiusKm]);

  const locate = async () => {
    setLocError(null);
    const r = await getDevicePosition();
    if (r.ok) setOrigin({ point: r.position, device: true });
    else setLocError(r.reason);
  };

  const select = (id: string) => {
    setSelectedId(id);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const sheetHeight = Math.round(height * 0.5);
  const header = (
    <View style={styles.sheetHead}>
      <View style={styles.titleRow}>
        <Text variant="heading" style={styles.flex} accessibilityRole="header">
          {t('places.nearby')}
        </Text>
        {!query.isPending ? (
          <Text variant="small" muted>
            {t('places.results', { n: items.length })}
          </Text>
        ) : null}
      </View>
      <Chips
        options={KINDS.map((k) => ({ value: k, label: k ? t(`seller.kind.${k}` as MessageKey) : t('places.kind.all') }))}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setSelectedId(null);
        }}
      />
      <Chips
        options={RADII_KM.map((n) => ({ value: String(n), label: t('places.radiusOption', { n }) }))}
        value={String(radiusKm)}
        onChange={(v) => setRadiusKm(Number(v))}
      />
      <View style={styles.shortcuts}>
        <ServiceTile icon="car-outline" label={t('mb.transport.ride')} onPress={() => router.push('/rides' as never)} />
        <ServiceTile icon="cube-outline" label={t('mb.transport.parcel')} tint={brandAccent} onPress={() => router.push('/courier?kind=parcel' as never)} />
        <ServiceTile icon="compass-outline" label={t('mb.explore.title')} onPress={() => router.push('/places/explore' as never)} />
        <ServiceTile icon="add-circle-outline" label={t('mb.add.link')} onPress={() => router.push('/places/add' as never)} />
      </View>
      <Button label={t('mb.transport.title')} variant="ghost" onPress={() => router.push('/transport' as never)} />
      <View style={styles.originRow}>
        <Text variant="caption" muted style={styles.flex}>
          {origin.device ? t('places.origin.device') : t('places.origin.goma')}
        </Text>
        {origin.device ? (
          <Button
            label={t('places.useGoma')}
            variant="ghost"
            onPress={() => {
              setOrigin({ point: GOMA_CENTER, device: false });
              setLocError(null);
            }}
          />
        ) : null}
      </View>
      {locError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t(locError === 'denied' ? 'places.denied' : 'places.unavailable')}
        </Text>
      ) : origin.device ? (
        // Le rappel n'a de sens que lorsque la position de l'appareil est utilisée.
        <Text variant="caption" muted>
          {t('places.privacy')}
        </Text>
      ) : null}
    </View>
  );

  let state;
  if (query.isPending) state = <SkeletonList rows={3} label={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0) state = <EmptyState icon="map-outline" title={t('places.emptyTitle')} body={t('places.emptyBody')} />;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.flex}>
        <TileMap
          style={StyleSheet.absoluteFill}
          fit={fit}
          fitKey={`${lat},${lng},${radiusKm}`}
          markers={markers}
          user={origin.device ? origin.point : null}
          onSelect={select}
          onLocate={locate}
        />
        <View style={[styles.search, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('places.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('places.search')}
            returnKeyType="search"
            autoCapitalize="none"
            maxLength={100}
            style={[styles.input, { color: colors.text }]}
          />
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setText('')} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.background, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <FlatList
          ref={listRef}
          data={state ? [] : ordered}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListEmptyComponent={state}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => <PlaceCard place={item} selected={item.id === selectedId} onFocus={() => select(item.id)} />}
        />
      </View>
    </View>
  );
}

const PlaceCard = memo(function PlaceCard({ place, selected, onFocus }: { place: Place; selected: boolean; onFocus: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const kind = t(`seller.kind.${place.kind}` as MessageKey);
  const distance = t('places.distance', { d: formatDistance(place.distanceKm, locale) });
  const sub = [kind, place.city, place.address].filter(Boolean).join(' · ');

  const go = async () => {
    try {
      await Linking.openURL(directionsUrl(platform, { lat: place.lat, lng: place.lng, label: place.label ?? place.name }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : StyleSheet.hairlineWidth }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('places.placeA11y', { name: place.name, kind, distance })}
        onPress={() => router.push(placeHref(place))}
        onLongPress={onFocus}
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.85 : 1 }]}
      >
        <AuthImage contentUrl={place.logoUrl} label={place.name} style={styles.logo} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {place.name}
          </Text>
          <Text variant="small" muted numberOfLines={2}>
            {sub}
          </Text>
          {place.label ? (
            <Text variant="caption" muted numberOfLines={1}>
              {place.label}
            </Text>
          ) : null}
          <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
            {distance}
          </Text>
        </View>
      </Pressable>
      <Button label={t('places.directions')} accessibilityLabel={t('places.directionsA11y', { name: place.name })} variant="secondary" onPress={go} />
      {failed ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t('places.directionsFailed')}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shortcuts: { flexDirection: 'row', gap: spacing.sm },
  pad: { padding: spacing.xl },
  content: { paddingHorizontal: spacing.lg, paddingBottom: TAB_BAR_SPACE, gap: spacing.md, flexGrow: 1 },
  search: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    minHeight: TOUCH,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  input: { flex: 1, fontSize: 16, minHeight: TOUCH, fontFamily: 'Poppins_400Regular' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginVertical: spacing.sm },
  sheetHead: { gap: spacing.sm, paddingBottom: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  card: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  main: { flexDirection: 'row', gap: spacing.md, minHeight: TOUCH },
  logo: { width: 56, height: 56, borderRadius: radius.md },
});
