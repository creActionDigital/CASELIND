import type { Notification, NotificationCategory, NotificationList } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { api } from '../../auth/auth-context';
import { useI18n, type MessageKey } from '../../i18n';
import { formatListTime } from '../../messaging/api';
import { qk } from '../../messaging/keys';
import { groupByDay } from '../../notifications/group';
import { fetchNotifications, useUnreadCount } from '../../notifications/hooks';
import { notificationTarget } from '../../notifications/targets';
import { radius, shadow, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, EmptyState, ErrorState, IconButton, Text } from '../../ui';
import { Chip, FadeInView, PressableScale, SkeletonList } from '../../ui/premium';

type Data = InfiniteData<NotificationList>;
type Icon = ComponentProps<typeof Ionicons>['name'];

// Filtres du centre : une catégorie à la fois (« Toutes » = aucun filtre).
const FILTERS: NotificationCategory[] = ['social', 'commerce', 'payment', 'delivery', 'booking', 'message', 'security', 'reminder', 'system'];
const ICONS: Record<NotificationCategory, Icon> = {
  social: 'people-outline',
  commerce: 'bag-handle-outline',
  payment: 'wallet-outline',
  delivery: 'bicycle-outline',
  booking: 'calendar-outline',
  message: 'chatbubble-outline',
  security: 'shield-checkmark-outline',
  reminder: 'alarm-outline',
  job: 'briefcase-outline',
  system: 'notifications-outline',
};
const DAY_LABEL = { today: 'ma.notif.today', yesterday: 'ma.notif.yesterday', week: 'ma.notif.week', older: 'ma.notif.older' } as const;

/** Centre de notifications : regroupé par jour, icône par catégorie, non lues marquées, filtres, « tout lire ». */
export default function NotificationCenter() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const unread = useUnreadCount();
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [category, setCategory] = useState<NotificationCategory | null>(null);

  const query = useInfiniteQuery({
    queryKey: category ? [...qk.notifications, category] : qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam, category ?? undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const mark = (fn: (n: Notification) => Notification) =>
    qc.setQueriesData<Data>({ queryKey: qk.notifications }, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map(fn) })) });

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

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const sections = useMemo(() => groupByDay(items), [items]);

  function open(n: Notification) {
    if (!n.readAt) readOne.mutate(n.id);
    const target = notificationTarget(n);
    // Jamais « rien » : sans écran concerné, la feuille de détail montre le texte complet.
    if (target) router.push(target as never);
    else setDetail(n);
  }

  const header = (
    <Stack.Screen
      options={{
        title: t('notifications.title'),
        headerRight: () => <IconButton icon="settings-outline" label={t('notifications.preferences')} onPress={() => router.push('/notification-preferences')} />,
      }}
    />
  );

  let body;
  if (query.isPending) {
    body = (
      <View style={styles.pad}>
        <SkeletonList rows={6} label={t('common.loading')} />
      </View>
    );
  } else if (query.isError && items.length === 0) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else {
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(n) => n.id}
        stickySectionHeadersEnabled={false}
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
        ListEmptyComponent={<EmptyState icon="notifications-outline" title={t('notifications.emptyTitle')} body={category ? t('ma.notif.emptyFiltered') : t('notifications.emptyBody')} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : <View style={{ height: spacing.xxl }} />}
        contentContainerStyle={items.length === 0 ? styles.grow : styles.list}
        renderSectionHeader={({ section }) => (
          <Text variant="caption" muted accessibilityRole="header" style={styles.section}>
            {t(DAY_LABEL[section.key] as MessageKey).toUpperCase()}
          </Text>
        )}
        renderItem={({ item: n, index }) => {
          const isUnread = !n.readAt;
          return (
            <FadeInView index={index}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? t('notifications.unreadA11y') + ', ' : ''}${n.title}, ${n.body}`}
                onPress={() => open(n)}
                style={[styles.card, shadow.card, { backgroundColor: isUnread ? colors.primarySoft : colors.surface }]}
              >
                {isUnread ? <View style={[styles.bar, { backgroundColor: colors.primary }]} /> : null}
                <View style={[styles.icon, { backgroundColor: isUnread ? colors.surface : colors.primarySoft }]}>
                  <Ionicons name={ICONS[n.category]} size={22} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.head}>
                    <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {n.title}
                    </Text>
                    <Text variant="caption" color={isUnread ? colors.primary : colors.textMuted}>
                      {formatListTime(n.createdAt, locale)}
                    </Text>
                  </View>
                  <Text variant="small" muted numberOfLines={2}>
                    {n.body}
                  </Text>
                </View>
              </PressableScale>
            </FadeInView>
          );
        }}
      />
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <View style={styles.top}>
        <Text variant="small" muted style={styles.flex}>
          {unread > 0 ? t('notifications.unreadCount', { n: unread }) : t('ma.notif.upToDate')}
        </Text>
        {unread > 0 ? <Button label={t('notifications.readAll')} variant="ghost" loading={readAll.isPending} onPress={() => readAll.mutate()} style={styles.barBtn} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.noGrow} contentContainerStyle={styles.filters} accessibilityRole="tablist">
        <Chip label={t('ma.notif.all')} selected={category === null} onPress={() => setCategory(null)} />
        {FILTERS.map((c) => (
          <Chip key={c} label={t(`notifications.cat.${c}` as MessageKey)} icon={ICONS[c]} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>
      {body}
      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.background }]}>
            <Text variant="title">{detail?.title}</Text>
            <Text variant="body">{detail?.body}</Text>
            <Text variant="caption" muted>
              {detail ? new Date(detail.createdAt).toLocaleString(locale) : ''}
            </Text>
            <Button label={t('common.close')} onPress={() => setDetail(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noGrow: { flexGrow: 0, height: 60 },
  grow: { flexGrow: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg },
  pad: { padding: spacing.xl },
  top: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm, minHeight: 44 },
  barBtn: { paddingHorizontal: spacing.md },
  filters: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { gap: spacing.md, padding: spacing.xl, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
