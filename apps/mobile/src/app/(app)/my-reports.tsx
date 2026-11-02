import { reportPageSchema } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { storyKeys } from '../../stories/keys';
import { Badge, Button, EmptyState, ErrorState, Text } from '../../ui';

/** Mes signalements : GET /v1/me/reports (ouvert / traité, sans dire quelle sanction). */
export default function MyReports() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const q = useInfiniteQuery({
    queryKey: storyKeys.myReports,
    queryFn: ({ pageParam }) => api.request('/me/reports', { query: { cursor: pageParam, limit: 20 }, schema: reportPageSchema }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (q.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <EmptyState icon="flag-outline" title={t('report.mine.emptyTitle')} body={t('report.mine.emptyBody')} />;
  return (
    <FlatList
      data={items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      renderItem={({ item: r }) => (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.line}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t(`report.target.${r.targetType}`)} · {t(`report.reason.${r.reason}`)}
            </Text>
            <Badge tone={r.resolved ? 'neutral' : 'primary'} label={t(r.resolved ? 'report.mine.resolved' : 'report.mine.open')} />
          </View>
          <Text variant="caption" muted>
            {new Date(r.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </View>
      )}
      ListFooterComponent={q.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 14, padding: spacing.lg, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
