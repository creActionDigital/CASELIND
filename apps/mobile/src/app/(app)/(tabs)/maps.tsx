import { Ionicons } from '@expo/vector-icons';
import type { OrgKind, Place } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchPlaces } from '../../../places/api';
import { getDevicePosition, isLocationGranted } from '../../../places/device-location';
import { directionsUrl, formatDistance, GOMA_CENTER, roundCoordinate, type LatLng, type MapsPlatform } from '../../../places/geo';
import { KIND_STYLE, MAP_CATEGORIES, placeHref, rideToHref } from '../../../places/kinds';
import { TileMap } from '../../../places/TileMap';
import { radiusPoints } from '../../../places/tiles';
import { useDebouncedValue } from '../../../search/api';
import { fonts, radius, spacing, TAB_BAR_SPACE, TOUCH } from '../../../theme/tokens';
import { ServiceTile, SkeletonList } from '../../../ui/premium';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../ui';

const platform: MapsPlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';
const RADIUS_KM = 10; // portée de la liste
const CITY_KM = 1.5; // cadrage initial : zoom ville
const PEEK = 76 + TAB_BAR_SPACE - 40; // feuille repliée : poignée et titre au-dessus de la barre d'onglets
const PREVIEW_SPACE = 214; // hauteur réservée à la carte d'aperçu

/** Carte plein écran à la Uber : recherche flottante, pastilles de catégories, feuille basse à 3 hauteurs, aperçu d'un lieu. */
export default function Maps() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // La position reste en mémoire de l'écran : jamais persistée, envoyée seulement en paramètres de requête.
  const [origin, setOrigin] = useState<{ point: LatLng; device: boolean }>({ point: GOMA_CENTER, device: false });
  const [locError, setLocError] = useState<'denied' | 'unavailable' | null>(null);
  const [locating, setLocating] = useState(false);
  const [askDismissed, setAskDismissed] = useState(false);
  const [kind, setKind] = useState<OrgKind | ''>('');
  const [text, setText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = useDebouncedValue(text.trim());
  const listRef = useRef<FlatList<Place>>(null);

  const lat = roundCoordinate(origin.point.lat);
  const lng = roundCoordinate(origin.point.lng);
  const query = useInfiniteQuery({
    queryKey: ['places', 'map', lat, lng, kind, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPlaces({ lat, lng, radiusKm: RADIUS_KM, kind: kind || undefined, q, limit: 50 }, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    gcTime: 60_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const selected = useMemo(() => items.find((p) => p.id === selectedId) ?? null, [items, selectedId]);
  const markers = useMemo(
    () => items.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, selected: p.id === selectedId, icon: KIND_STYLE[p.kind].icon, color: KIND_STYLE[p.kind].color })),
    [items, selectedId],
  );
  // Zoom ville autour de l'origine ; un lieu choisi recentre la carte sur lui.
  const fit = useMemo(() => (selected ? [{ lat: selected.lat, lng: selected.lng }] : radiusPoints(origin.point, CITY_KM)), [selected, origin.point]);

  // ---- feuille glissante à 3 hauteurs ----
  const heights = useMemo(() => [PEEK, Math.round(height * 0.5), Math.round(height * 0.86)], [height]);
  const [snap, setSnap] = useState(1);
  const sheetH = useRef(new Animated.Value(heights[1]!)).current;
  const cur = useRef({ h: heights[1]!, start: 0, snap: 1, heights });
  cur.current.heights = heights;
  useEffect(() => {
    const id = sheetH.addListener(({ value }) => (cur.current.h = value));
    return () => sheetH.removeListener(id);
  }, [sheetH]);
  const settle = (i: number) => {
    cur.current.snap = i;
    setSnap(i);
    Animated.spring(sheetH, { toValue: cur.current.heights[i]!, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  };
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          cur.current.start = cur.current.h;
        },
        onPanResponderMove: (_e, s) => {
          const hs = cur.current.heights;
          sheetH.setValue(Math.min(hs[2]!, Math.max(hs[0]!, cur.current.start - s.dy)));
        },
        onPanResponderRelease: (_e, s) => {
          const c = cur.current;
          if (Math.abs(s.dy) < 6) return settle((c.snap + 1) % 3); // simple appui : hauteur suivante
          const target = c.h - s.vy * 160;
          let best = 0;
          c.heights.forEach((h, i) => {
            if (Math.abs(h - target) < Math.abs(c.heights[best]! - target)) best = i;
          });
          settle(best);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tout passe par `cur` (réf. stable).
    [sheetH],
  );
  useEffect(() => {
    cur.current.snap = Math.min(cur.current.snap, 2);
    sheetH.setValue(heights[cur.current.snap]!);
  }, [heights, sheetH]);

  // ---- position ----
  const locate = async () => {
    setLocError(null);
    setLocating(true);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) {
      setOrigin({ point: r.position, device: true });
      setSelectedId(null);
    } else setLocError(r.reason);
  };
  // Permission déjà accordée : on centre d'emblée la carte sur l'utilisateur ; sinon on reste sur Goma et on explique avant de demander.
  useEffect(() => {
    void isLocationGranted().then((ok) => {
      if (ok) void locate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois à l'ouverture.
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    settle(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const inset = selected ? PEEK + PREVIEW_SPACE : heights[snap]!;
  const askLocation = !origin.device && !askDismissed && !locError;

  const header = (
    <View style={styles.sheetHead}>
      {askLocation ? (
        <View style={[styles.ask, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="navigate-circle" size={28} color={colors.primary} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{t('places.locate.title')}</Text>
            <Text variant="small" muted>
              {t('places.locate.body')}
            </Text>
            <View style={styles.askButtons}>
              <Button label={t('places.locate.enable')} onPress={locate} loading={locating} style={styles.flex} />
              <Button label={t('places.locate.later')} variant="ghost" onPress={() => setAskDismissed(true)} />
            </View>
          </View>
        </View>
      ) : null}
      {origin.device ? (
        <View style={styles.originRow}>
          <Text variant="caption" muted style={styles.flex}>
            {t('places.origin.device')}. {t('places.privacy')}
          </Text>
          <Button label={t('places.useGoma')} variant="ghost" onPress={() => setOrigin({ point: GOMA_CENTER, device: false })} />
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      <View style={styles.shortcuts}>
        <ServiceTile icon="car-outline" label={t('mb.transport.ride')} onPress={() => router.push('/rides' as never)} />
        <ServiceTile icon="compass-outline" label={t('mb.explore.title')} onPress={() => router.push('/places/explore' as never)} />
        <ServiceTile icon="add-circle-outline" label={t('mb.add.link')} onPress={() => router.push('/places/add' as never)} />
      </View>
    </View>
  );

  let state;
  if (query.isPending) state = <SkeletonList rows={3} label={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0) state = <EmptyState icon="map-outline" title={t('places.emptyTitle')} body={t('places.emptyBody')} />;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <TileMap
        style={StyleSheet.absoluteFill}
        fit={fit}
        fitKey={selected ? `sel:${selected.id}` : `${lat},${lng}`}
        markers={markers}
        user={origin.device ? origin.point : null}
        onSelect={select}
        onLocate={locate}
        bottomInset={inset}
      />

      <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills} keyboardShouldPersistTaps="handled">
          {MAP_CATEGORIES.map((k) => {
            const on = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setKind(on ? '' : k);
                  setSelectedId(null);
                }}
                style={[styles.pill, { backgroundColor: on ? colors.primary : colors.surface }]}
              >
                <Ionicons name={KIND_STYLE[k].icon} size={16} color={on ? colors.onPrimary : KIND_STYLE[k].color} />
                <Text variant="small" style={{ color: on ? colors.onPrimary : colors.text, fontWeight: '700' }}>
                  {t(`places.cat.${k}` as MessageKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {locError ? (
          <View style={[styles.notice, { backgroundColor: colors.surface }]} accessibilityLiveRegion="polite">
            <Text variant="small" color={colors.danger}>
              {t(locError === 'denied' ? 'places.denied' : 'places.unavailable')}
            </Text>
          </View>
        ) : null}
      </View>

      {selected ? <Preview place={selected} onClose={() => setSelectedId(null)} /> : null}

      <Animated.View style={[styles.sheet, { height: sheetH, backgroundColor: colors.background, borderColor: colors.border }]}>
        <View {...drag.panHandlers} accessibilityRole="button" accessibilityLabel={t('places.sheetA11y')} style={styles.grab}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
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
        </View>
        <FlatList
          ref={listRef}
          data={state ? [] : items}
          keyExtractor={(p) => p.id}
          scrollEnabled={snap >= 1}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          ListEmptyComponent={state}
          ListFooterComponent={footer}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => <PlaceRow place={item} onPress={() => select(item.id)} />}
        />
      </Animated.View>
    </View>
  );
}

function OpenBadge({ open }: { open: boolean | null }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  if (open === null) return null;
  return (
    <Text variant="small" style={{ color: open ? colors.success : colors.danger, fontWeight: '700' }}>
      {t(open ? 'places.open' : 'places.closed')}
    </Text>
  );
}

function KindBadge({ kind, size = 44 }: { kind: OrgKind; size?: number }) {
  const s = KIND_STYLE[kind];
  return (
    <View style={[styles.kindBadge, { width: size, height: size, borderRadius: size / 2, backgroundColor: s.color }]}>
      <Ionicons name={s.icon} size={size * 0.5} color="#fff" />
    </View>
  );
}

const PlaceRow = memo(function PlaceRow({ place, onPress }: { place: Place; onPress: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const kind = t(`seller.kind.${place.kind}` as MessageKey);
  const distance = t('places.distance', { d: formatDistance(place.distanceKm, locale) });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('places.placeA11y', { name: place.name, kind, distance })}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <KindBadge kind={place.kind} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </Text>
        <Text variant="small" muted numberOfLines={1}>
          {[kind, place.address].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.meta}>
          <Text variant="small" color={colors.primary} style={{ fontWeight: '700' }}>
            {distance}
          </Text>
          <OpenBadge open={place.openNow} />
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
});

/** Carte d'aperçu d'un lieu choisi : itinéraire, appel, fiche, course. */
function Preview({ place, onClose }: { place: Place; onClose: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const kind = t(`seller.kind.${place.kind}` as MessageKey);
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <View style={[styles.preview, { backgroundColor: colors.surface, bottom: PEEK + spacing.sm }]}>
      <View style={styles.previewHead}>
        <KindBadge kind={place.kind} size={48} />
        <View style={styles.flex}>
          <Text variant="heading" numberOfLines={1}>
            {place.name}
          </Text>
          <Text variant="small" muted numberOfLines={1}>
            {[kind, t('places.distance', { d: formatDistance(place.distanceKm, locale) }), place.address].filter(Boolean).join(' · ')}
          </Text>
          <OpenBadge open={place.openNow} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Button
          label={t('places.directions')}
          accessibilityLabel={t('places.directionsA11y', { name: place.name })}
          style={styles.action}
          onPress={() => open(directionsUrl(platform, { lat: place.lat, lng: place.lng, label: place.label ?? place.name }))}
        />
        {place.phone ? <Button label={t('places.call')} accessibilityLabel={t('places.callA11y', { name: place.name })} variant="secondary" style={styles.action} onPress={() => open(`tel:${place.phone}`)} /> : null}
        <Button label={t('places.viewPlace')} variant="secondary" style={styles.action} onPress={() => router.push(placeHref(place))} />
        <Button label={t('places.rideTo')} variant="secondary" style={styles.action} onPress={() => router.push(rideToHref(place) as never)} />
      </View>
      {place.source === 'osm' ? (
        <Text variant="caption" muted>
          © contributeurs OpenStreetMap (ODbL)
        </Text>
      ) : null}
      {failed ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t('places.directionsFailed')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  top: { position: 'absolute', left: 0, right: 0, gap: spacing.sm },
  search: {
    marginHorizontal: spacing.lg,
    minHeight: TOUCH + 4,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  input: { flex: 1, fontSize: 16, minHeight: TOUCH, fontFamily: fonts.regular },
  pills: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  notice: { marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radius.md },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
  grab: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, marginVertical: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingBottom: TAB_BAR_SPACE, gap: spacing.sm, flexGrow: 1 },
  sheetHead: { gap: spacing.sm },
  ask: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg },
  askButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, minHeight: 64 },
  meta: { flexDirection: 'row', gap: spacing.md },
  kindBadge: { alignItems: 'center', justifyContent: 'center' },
  footer: { gap: spacing.md, paddingTop: spacing.sm },
  shortcuts: { flexDirection: 'row', gap: spacing.sm },
  preview: { position: 'absolute', left: spacing.lg, right: spacing.lg, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10, zIndex: 5 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: '45%' },
});
