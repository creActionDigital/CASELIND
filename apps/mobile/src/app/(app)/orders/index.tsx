import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchOrders } from '../../../shop/api';
import { formatMoney } from '../../../shop/format';
import { shopKeys } from '../../../shop/hooks';
import { StatusPill } from '../../../shop/parts';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../ui';

export default function Orders() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const query = useInfiniteQuery({
    queryKey: [...shopKeys.orders, 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrders(undefined, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  let body;
  if (query.isPending) body = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  else if (query.isError && items.length === 0) body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.content}
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
        ListHeaderComponent={<Button variant="secondary" label={t('loyalty.title')} onPress={() => router.push('/loyalty' as never)} />}
        ListEmptyComponent={<EmptyState icon="receipt-outline" title={t('orders.emptyTitle')} body={t('orders.emptyBody')} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        renderItem={({ item: o }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('orders.number', { number: o.number })}, ${o.orgName}, ${t(`orders.status.${o.status}`)}`}
            onPress={() => router.push({ pathname: '/orders/[orderId]', params: { orderId: o.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={styles.row}>
              <Text variant="bodyStrong" style={styles.flex}>
                {o.number}
              </Text>
              <StatusPill status={o.status} />
            </View>
            <Text variant="small" muted numberOfLines={1}>
              {o.orgName} · {t('orders.items', { n: o.items.reduce((n, i) => n + i.quantity, 0) })}
            </Text>
            <View style={styles.row}>
              <Text variant="caption" muted style={styles.flex}>
                {new Date(o.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              <Text variant="bodyStrong">{formatMoney(o.totalMinor, o.currency, locale)}</Text>
            </View>
          </Pressable>
        )}
      />
    );
  }
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('orders.title') }} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.xs, minHeight: 88 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
