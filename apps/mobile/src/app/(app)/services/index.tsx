import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { getDevicePosition } from '../../../places/device-location';
import { DEFAULT_RADIUS_KM, GOMA_CENTER, RADII_KM, type LatLng } from '../../../places/geo';
import { useDebouncedValue } from '../../../search/api';
import { Chips, PagedList } from '../../../seller/ui';
import { Chip, ChipRow, FadeInView } from '../../../ui/premium';
import { fetchDiscovery, fetchServiceCategories, svcKeys } from '../../../services/api';
import { OfferCard } from '../../../services/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, IconButton, Text, TextField } from '../../../ui';

/** Découverte des services : catégories en pastilles, recherche, distance autour de Goma ou de la position. */
export default function Services() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const [categoryId, setCategoryId] = useState<string>('');
  // La position reste en mémoire de l'écran : jamais persistée, envoyée seulement en paramètres de requête.
  const [origin, setOrigin] = useState<{ point: LatLng; device: boolean }>({ point: GOMA_CENTER, device: false });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<'denied' | 'unavailable' | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);

  const categories = useQuery({ queryKey: svcKeys.categories, queryFn: fetchServiceCategories, staleTime: 10 * 60_000 });
  const filters = useMemo(
    () => ({ q: q || undefined, categoryId: categoryId || undefined, lat: origin.point.lat, lng: origin.point.lng, radiusKm }),
    [q, categoryId, origin, radiusKm],
  );
  const query = useInfiniteQuery({
    queryKey: svcKeys.discovery(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchDiscovery(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  async function locate() {
    setLocating(true);
    setLocError(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) setOrigin({ point: r.position, device: true });
    else {
      setOrigin({ point: GOMA_CENTER, device: false });
      setLocError(r.reason);
    }
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View style={styles.flex}>
          <TextField label={t('services.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
        </View>
      </View>
      <View style={styles.pad}><ChipRow>
        {[{ id: '', name: t('services.all') }, ...(categories.data?.items ?? [])].map((c) => (
          <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id === categoryId ? '' : c.id)} />
        ))}
      </ChipRow></View>
      <View style={styles.originRow}>
        <Text variant="small" muted>
          {t('services.near.label')}
        </Text>
        <Button
          variant={origin.device ? 'secondary' : 'primary'}
          label={t('services.near.goma')}
          onPress={() => {
            setOrigin({ point: GOMA_CENTER, device: false });
            setLocError(null);
          }}
          style={[styles.originBtn, { flex: 0.8 }]}
        />
        <Button
          variant={origin.device ? 'primary' : 'secondary'}
          label={locating ? t('services.near.locating') : t('services.near.device')}
          loading={locating}
          onPress={locate}
          style={[styles.originBtn, { flex: 1.2 }]}
        />
      </View>
      {locError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.pad}>
          {locError === 'denied' ? t('services.near.denied') : t('services.near.unavailable')}
        </Text>
      ) : null}
      <Chips options={RADII_KM.map((r) => ({ value: String(r), label: `${r} km` }))} value={String(radiusKm)} onChange={(v) => setRadiusKm(Number(v))} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('services.title'),
          headerRight: () => <IconButton icon="calendar-outline" label={t('bookings.title')} onPress={() => router.push('/bookings')} />,
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(o) => o.id}
        header={header}
        renderItem={({ item, index }) => (
          <FadeInView index={index}>
            <OfferCard offer={item} onPress={() => router.push({ pathname: '/services/[id]', params: { id: item.id } })} />
          </FadeInView>
        )}
        empty={{ icon: 'construct-outline', title: t('services.emptyTitle'), body: t('services.emptyBody') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: spacing.sm },
  searchRow: { paddingHorizontal: spacing.lg },
  pad: { paddingHorizontal: spacing.lg },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  originBtn: { flex: 1 },
});
