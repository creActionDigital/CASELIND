import type { Notification, NotificationList } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { useI18n, type MessageKey } from '../../i18n';
import { formatListTime } from '../../messaging/api';
import { qk } from '../../messaging/keys';
import { fetchNotifications, useUnreadCount } from '../../notifications/hooks';
import { deliveryTarget } from '../../delivery/routing';
import { commerceTarget } from '../../shop/order-logic';
import { sellerTarget } from '../../seller/routing';
import { socialTarget } from '../../social/routing';
import { walletTarget } from '../../wallet/routing';
import { bookingTarget } from '../../services/logic';
import { spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, EmptyState, ErrorState, IconButton, Text } from '../../ui';

type Data = InfiniteData<NotificationList>;

/** Centre de notifications : liste paginée, non-lus, lecture individuelle et « tout lire ». */
export default function NotificationCenter() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const unread = useUnreadCount();
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const mark = (fn: (n: Notification) => Notification) =>
    qc.setQueryData<Data>(qk.notifications, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map(fn) })) });

  const readOne = useMutation({
    mutationFn: (id: string) => api.request(`/notifications/${id}/read`, { method: 'POST' }),
    onMutate: (id) => mark((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.unreadCount }),
  });
  const readAll = useMutation({
    mutationFn: () => api.request('/notifications/read-all', { method: 'POST' }),
    onMutate: () => mark((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.unreadCount });
      void qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  function open(n: Notification) {
    if (!n.readAt) readOne.mutate(n.id);
    const conversationId = n.data.conversationId;
    if (conversationId) return router.push({ pathname: '/messages/[conversationId]', params: { conversationId } });
    if (n.category === 'delivery') {
      const seller = sellerTarget(n.data);
      if (seller) return router.push(seller);
      const target = deliveryTarget(n.data);
      if (target) return router.push(target);
    }
    if (n.category === 'commerce') {
      // `data.orgId` présent : commande reçue par une boutique -> route vendeur ; sinon route acheteur (M3a).
      const seller = sellerTarget(n.data);
      if (seller) return router.push(seller);
      const target = commerceTarget(n.data);
      if (target) router.push(target);
    }
    if (n.category === 'booking') {
      const target = bookingTarget(n.data);
      if (target) return router.push(target);
    }
    if (n.category === 'payment') return router.push(walletTarget(n.data));
    if (n.category === 'social') {
      const target = socialTarget(n.data);
      if (target) router.push(target);
    }
  }

  const header = (
    <Stack.Screen
      options={{
        title: t('notifications.title'),
        headerRight: () => (
          <IconButton icon="settings-outline" label={t('notifications.preferences')} onPress={() => router.push('/notification-preferences')} />
        ),
      }}
    />
  );

  let body;
  if (query.isPending) {
    body = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  } else if (query.isError && items.length === 0) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
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
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<EmptyState icon="notifications-outline" title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : undefined}
        contentContainerStyle={items.length === 0 ? styles.grow : undefined}
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${n.readAt ? '' : t('notifications.unreadA11y') + ', '}${n.title}, ${n.body}`}
            onPress={() => open(n)}
            style={[styles.row, { borderBottomColor: colors.border, backgroundColor: n.readAt ? colors.background : colors.primarySoft }]}
          >
            <View style={[styles.dot, { backgroundColor: n.readAt ? 'transparent' : colors.primary }]} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {n.title}
              </Text>
              <Text variant="small" muted numberOfLines={2}>
                {n.body}
              </Text>
              <Text variant="caption" muted>
                {t(`notifications.cat.${n.category}` as MessageKey)} · {formatListTime(n.createdAt, locale)}
              </Text>
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      {unread > 0 ? (
        <View style={[styles.bar, { borderBottomColor: colors.border }]}>
          <Text variant="small" muted>
            {t('notifications.unreadCount', { n: unread })}
          </Text>
          <Button label={t('notifications.readAll')} variant="ghost" loading={readAll.isPending} onPress={() => readAll.mutate()} style={styles.barBtn} />
        </View>
      ) : null}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1, justifyContent: 'center' },
  pad: { padding: spacing.xl },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  barBtn: { paddingHorizontal: spacing.md },
  row: { minHeight: TOUCH + 28, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
