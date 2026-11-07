import type { FavoriteMessage } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { fetchFavorites, extrasKeys, setFavorite } from '../../messaging/extras-api';
import { messagePreview } from '../../messaging/api';
import { spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { EmptyState, ErrorState, IconButton, Text } from '../../ui';

type Data = InfiniteData<{ items: FavoriteMessage[]; nextCursor: string | null }>;

/** Messages favoris : liste en défilement infini ; un tap ouvre la conversation au message. */
export default function Favorites() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: extrasKeys.favorites,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFavorites(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (messageId: string) => setFavorite(messageId, false),
    onMutate: (messageId) =>
      qc.setQueryData<Data>(
        extrasKeys.favorites,
        (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((f) => f.message.id !== messageId) })) },
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: extrasKeys.favorites }),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const header = <Stack.Screen options={{ title: t('messagesX.fav.title') }} />;

  if (query.isPending) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {header}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (query.isError && items.length === 0) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {header}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(f) => f.message.id}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={items.length === 0 ? styles.grow : undefined}
        ListEmptyComponent={<EmptyState icon="star-outline" title={t('messagesX.fav.emptyTitle')} body={t('messagesX.fav.emptyBody')} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : undefined}
        renderItem={({ item }) => {
          const m = item.message;
          const text = messagePreview(m, t) || t('messagesX.fav.photo');
          const when = new Date(m.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
          return (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${text}, ${when}`}
                accessibilityHint={t('messagesX.fav.open')}
                onPress={() =>
                  router.push({ pathname: '/messages/[conversationId]', params: { conversationId: m.conversationId, focus: m.id } })
                }
                style={styles.body}
              >
                <Text numberOfLines={3}>{text}</Text>
                <Text variant="caption" muted>
                  {when}
                </Text>
              </Pressable>
              <IconButton icon="star" label={t('messagesX.fav.remove')} color={colors.primary} onPress={() => remove.mutate(m.id)} />
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  pad: { padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm, minHeight: TOUCH + 24, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { flex: 1, gap: 2, paddingVertical: spacing.md },
});
