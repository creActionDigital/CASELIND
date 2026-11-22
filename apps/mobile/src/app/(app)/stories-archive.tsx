import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { fetchStoryArchive } from '../../stories/api';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { AuthImage, Button, EmptyState, ErrorState, Screen, Text } from '../../ui';

/** Archive de mes statuts : tous, expirés compris (GET /me/stories/archive). */
export default function StoriesArchive() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const q = useInfiniteQuery({
    queryKey: ['stories-archive'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchStoryArchive(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('sarch.title') }} />
      {q.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="images-outline" title={t('sarch.empty')} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((s) => (
            <View key={s.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <AuthImage contentUrl={s.mediaUrl} label={s.caption ?? t('sarch.title')} style={styles.thumb} />
              <View style={{ flex: 1, gap: 2 }}>
                {s.caption ? <Text numberOfLines={2}>{s.caption}</Text> : null}
                <Text variant="small" muted>{new Date(s.createdAt).toLocaleString(locale)}</Text>
                <Text variant="small" muted>{t('sarch.views', { n: s.viewCount ?? 0 })}</Text>
              </View>
            </View>
          ))}
          {q.hasNextPage ? <Button variant="secondary" label={t('odel.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  thumb: { width: 64, height: 96, borderRadius: radius.sm },
});
