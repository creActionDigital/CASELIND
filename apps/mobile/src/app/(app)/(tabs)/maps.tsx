import { orgKindSchema, type OrgKind, type Place } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
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
import { useDebouncedValue } from '../../../search/api';
import { Chips } from '../../../seller/ui';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Button, EmptyState, ErrorState, Text, TextField } from '../../../ui';

// Catégories demandées en premier (boutiques, restaurants, pharmacies, stations-service), puis les autres.
const FIRST = ['shop', 'restaurant', 'pharmacy', 'fuel_station'] as const;
const KINDS = ['', ...FIRST, ...orgKindSchema.options.filter((k) => !(FIRST as readonly string[]).includes(k))] as const;
type KindFilter = (typeof KINDS)[number];

const platform: MapsPlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

export default function Maps() {
  const { colors } = useTheme();
  const { t } = useI18n();
  // La position reste en mémoire de l'écran : jamais persistée, envoyée seulement en paramètres de requête.
  const [origin, setOrigin] = useState<{ point: LatLng; device: boolean }>({ point: GOMA_CENTER, device: false });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<'denied' | 'unavailable' | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [kind, setKind] = useState<KindFilter>('');
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const [refreshing, setRefreshing] = useState(false);

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

  const locate = async () => {
    setLocating(true);
    setLocError(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) setOrigin({ point: r.position, device: true });
    else setLocError(r.reason);
  };

  const header = (
    <View style={styles.header}>
      <TextField label={t('places.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" maxLength={100} />
      <Text variant="small" muted>
        {origin.device ? t('places.origin.device') : t('places.origin.goma')}
      </Text>
      <View style={styles.locRow}>
        <Button
          label={locating ? t('places.locating') : t('places.useMyLocation')}
          variant="secondary"
          loading={locating}
          onPress={locate}
          style={styles.flex}
        />
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
      ) : (
        <Text variant="caption" muted>
          {t('places.privacy')}
        </Text>
      )}
      <Text variant="small" style={styles.label}>
        {t('places.radius')}
      </Text>
      <Chips
        options={RADII_KM.map((n) => ({ value: String(n), label: t('places.radiusOption', { n }) }))}
        value={String(radiusKm)}
        onChange={(v) => setRadiusKm(Number(v))}
      />
      <Chips
        options={KINDS.map((k) => ({ value: k, label: k ? t(`seller.kind.${k}` as MessageKey) : t('places.kind.all') }))}
        value={kind}
        onChange={setKind}
      />
    </View>
  );

  let state;
  if (query.isPending) state = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0) state = <EmptyState icon="map-outline" title={t('places.emptyTitle')} body={t('places.emptyBody')} />;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={state ? [] : items}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={state}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await query.refetch();
              setRefreshing(false);
            }}
          />
        }
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <PlaceCard place={item} />}
      />
    </View>
  );
}

const PlaceCard = memo(function PlaceCard({ place }: { place: Place }) {
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
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('places.placeA11y', { name: place.name, kind, distance })}
        onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: place.slug } })}
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
  pad: { padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  header: { gap: spacing.sm },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontWeight: '600', marginTop: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  main: { flexDirection: 'row', gap: spacing.md, minHeight: TOUCH },
  logo: { width: 56, height: 56, borderRadius: radius.md },
});
