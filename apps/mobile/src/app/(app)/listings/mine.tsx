import type { Listing } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchMyListings, listingKeys } from '../../../listings/api';
import { PagedList } from '../../../seller/ui';
import { useTheme } from '../../../theme/use-theme';
import { ListingCard } from './index';

/** Mes annonces, actives et clôturées. */
export default function MyListings() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const query = useInfiniteQuery({
    queryKey: listingKeys.mine,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMyListings(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('listings.mine') }} />
      <PagedList
        query={query}
        keyExtractor={(l: Listing) => l.id}
        renderItem={({ item }) => <ListingCard item={item} onPress={() => router.push({ pathname: '/listings/[id]', params: { id: item.id } })} />}
        empty={{ icon: 'pricetags-outline', title: t('listings.mineEmpty'), actionLabel: t('listings.new'), onAction: () => router.push('/listings/new') }}
      />
    </View>
  );
}
