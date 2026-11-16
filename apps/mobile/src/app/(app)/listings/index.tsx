import type { Listing, ListingKind } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchListings, listingKeys } from '../../../listings/api';
import { kindKey, LISTING_KINDS, priceLabel } from '../../../listings/logic';
import { useDebouncedValue } from '../../../search/api';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, IconButton, Text, TextField } from '../../../ui';

/** Petites annonces : catégories en pastilles, recherche, liste récente d'abord. */
export default function Listings() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const [kind, setKind] = useState<ListingKind | ''>('');
  const filters = useMemo(() => ({ kind: kind || undefined, q: q || undefined }), [kind, q]);
  const query = useInfiniteQuery({
    queryKey: listingKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchListings(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const header = (
    <View style={styles.header}>
      <View style={styles.pad}>
        <TextField label={t('listings.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
      </View>
      <Chips
        options={[{ value: '' as const, label: t('listings.all') }, ...LISTING_KINDS.map((k) => ({ value: k, label: t(kindKey(k)) }))]}
        value={kind}
        onChange={(v) => setKind(v === kind ? '' : v)}
      />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('listings.title'),
          headerRight: () => (
            <View style={styles.actions}>
              <IconButton icon="notifications-outline" label={t('listings.alerts')} onPress={() => router.push('/listings/alerts')} />
              <IconButton icon="albums-outline" label={t('listings.mine')} onPress={() => router.push('/listings/mine')} />
              <IconButton icon="add-circle-outline" label={t('listings.new')} onPress={() => router.push('/listings/new')} />
            </View>
          ),
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(l: Listing) => l.id}
        header={header}
        renderItem={({ item }) => <ListingCard item={item} onPress={() => router.push({ pathname: '/listings/[id]', params: { id: item.id } })} />}
        empty={{ icon: 'pricetags-outline', title: t('listings.emptyTitle'), body: t('listings.emptyBody'), actionLabel: t('listings.new'), onAction: () => router.push('/listings/new') }}
      />
    </View>
  );
}

export function ListingCard({ item, onPress }: { item: Listing; onPress: () => void }) {
  const { t, locale } = useI18n();
  const price = priceLabel(item, locale);
  const photo = item.mediaIds[0];
  return (
    <Card onPress={onPress} label={item.title} style={styles.card}>
      <View style={styles.row}>
        {photo ? <AuthImage contentUrl={`/v1/media/${photo}/content`} label={item.title} style={styles.thumb} /> : null}
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {item.title}
          </Text>
          {price ? <Text variant="bodyStrong">{price}</Text> : null}
          <Text variant="small" muted numberOfLines={1}>
            {t(kindKey(item.kind))} · {item.city}
          </Text>
          {item.status === 'closed' ? <Badge tone="neutral" label={t('listings.closed')} /> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.lg },
  actions: { flexDirection: 'row' },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 88, height: 88 },
});
