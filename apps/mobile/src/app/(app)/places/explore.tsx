import { Ionicons } from '@expo/vector-icons';
import type { OrgKind, Place } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { loadRecent, pushRecent, saveRecent } from '../../../lib/recent-list';
import { fetchPlaces } from '../../../places/api';
import { formatDistance, GOMA_CENTER } from '../../../places/geo';
import { placeHref } from '../../../places/kinds';
import { useDebouncedValue } from '../../../search/api';
import { Card } from '../../../seller/ui';
import { spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';
import { getDevicePosition } from '../../../places/device-location';

/** Clé de stockage local : l'historique des recherches de lieux ne quitte jamais l'appareil. */
export const PLACE_SEARCH_KEY = 'caselind-place-searches.json';
const SECTIONS: OrgKind[] = ['restaurant', 'hotel', 'pharmacy', 'hospital', 'school', 'services', 'shop', 'fuel_station'];

/** Explorer autour de soi : recherche de lieux avec historique, puis les lieux les plus proches de chaque catégorie. */
export default function ExplorePlaces() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [origin, setOrigin] = useState(GOMA_CENTER);
  const q = useDebouncedValue(text.trim());

  useEffect(() => {
    void loadRecent(PLACE_SEARCH_KEY).then(setHistory);
    void getDevicePosition().then((r) => r.ok && setOrigin(r.position));
  }, []);

  const results = useQuery({
    queryKey: ['places-explore', origin.lat.toFixed(3), origin.lng.toFixed(3), q],
    queryFn: () => fetchPlaces({ ...origin, radiusKm: 25, q: q || undefined }),
  });

  const remember = (v: string) => {
    const next = pushRecent(history, v);
    setHistory(next);
    void saveRecent(PLACE_SEARCH_KEY, next);
  };
  const clear = () => {
    setHistory([]);
    void saveRecent(PLACE_SEARCH_KEY, []);
  };
  const open = (p: Place) => {
    if (q) remember(q);
    router.push(placeHref(p));
  };

  const items = results.data?.items ?? [];
  const groups = q ? [] : SECTIONS.map((k) => ({ kind: k, places: items.filter((p) => p.kind === k).slice(0, 3) })).filter((g) => g.places.length > 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mb.explore.title') }} />
      <TextField label={t('places.search')} value={text} onChangeText={setText} placeholder={t('places.searchPlaceholder')} maxLength={100} returnKeyType="search" onSubmitEditing={() => text.trim() && remember(text)} />
      {!text && history.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex} accessibilityRole="header">
              {t('mb.explore.history')}
            </Text>
            <Button variant="ghost" label={t('mb.explore.clear')} onPress={clear} />
          </View>
          {history.map((h) => (
            <Pressable key={h} accessibilityRole="button" accessibilityLabel={h} onPress={() => setText(h)} style={styles.hist}>
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <Text style={styles.flex}>{h}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {results.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      {results.isError ? <ErrorState error={results.error} onRetry={() => results.refetch()} /> : null}
      {results.isSuccess && items.length === 0 ? <EmptyState icon="map-outline" title={t('places.emptyTitle')} body={t('places.emptyBody')} /> : null}
      {q
        ? items.map((p) => <PlaceRow key={p.id} p={p} locale={locale} onPress={() => open(p)} />)
        : groups.map((g) => (
            <View key={g.kind} style={{ gap: spacing.sm }}>
              <Text variant="heading" accessibilityRole="header">
                {t(`seller.kind.${g.kind}` as MessageKey)}
              </Text>
              {g.places.map((p) => (
                <PlaceRow key={p.id} p={p} locale={locale} onPress={() => open(p)} />
              ))}
            </View>
          ))}
      <Button variant="secondary" label={t('mb.explore.onMap')} onPress={() => router.push('/maps' as never)} />
      <Button variant="ghost" label={t('mb.add.link')} onPress={() => router.push('/places/add' as never)} />
    </Screen>
  );
}

function PlaceRow({ p, locale, onPress }: { p: Place; locale: string; onPress: () => void }) {
  const { t } = useI18n();
  return (
    <Card label={p.name} onPress={onPress} style={{ gap: 2 }}>
      <Text variant="bodyStrong" numberOfLines={1}>
        {p.name}
      </Text>
      <Text variant="small" muted numberOfLines={1}>
        {[t(`seller.kind.${p.kind}` as MessageKey), p.city].filter(Boolean).join(' · ')} · {t('places.distance', { d: formatDistance(p.distanceKm, locale) })}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hist: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
