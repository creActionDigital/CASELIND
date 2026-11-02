import type { Conversation } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SheetModal } from '../../../components/SheetModal';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { conversationTitle, fetchConversations, patchMyState } from '../../../messaging/api';
import { isMuted, patchConversation, removeConversation, type ConversationPages } from '../../../messaging/cache';
import { ConversationRow } from '../../../messaging/ConversationRow';
import { qk } from '../../../messaging/keys';
import { NewConversationSheet } from '../../../messaging/NewConversationSheet';
import { PushCard } from '../../../notifications/PushCard';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../ui';

const FOREVER = '2100-01-01T00:00:00.000Z';

/** Onglet Messagerie : liste des conversations (épinglées d'abord), actions longues, nouvelle conversation. */
export default function Messages() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [target, setTarget] = useState<Conversation | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: qk.conversations(archived),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchConversations(archived, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const act = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { mutedUntil?: string | null; pinned?: boolean; archived?: boolean } }) =>
      patchMyState(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: qk.conversationsAll });
      const previous = qc.getQueriesData<ConversationPages>({ queryKey: qk.conversationsAll });
      qc.setQueriesData<ConversationPages>({ queryKey: qk.conversationsAll }, (d) =>
        body.archived !== undefined ? removeConversation(d, id) : patchConversation(d, id, body),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.conversationsAll }),
  });

  const open = useCallback(
    (c: Conversation) => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: c.id } }),
    [router],
  );
  const longPress = useCallback((c: Conversation) => setTarget(c), []);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  async function refresh() {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  }
  function apply(body: { mutedUntil?: string | null; pinned?: boolean; archived?: boolean }) {
    if (target) act.mutate({ id: target.id, body });
    setTarget(null);
  }

  let content;
  if (query.isPending) {
    content = <ActivityIndicator style={styles.center} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  } else if (query.isError && items.length === 0) {
    // Inclut l'accès refusé (403 : messagerie désactivée ou non autorisée).
    content = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else {
    content = (
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow conversation={item} onPress={open} onLongPress={longPress} />}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={archived ? undefined : <PushCard />}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title={archived ? t('chat.emptyArchivedTitle') : t('messages.emptyTitle')}
            body={archived ? t('chat.emptyArchivedBody') : t('messages.emptyBody')}
            actionLabel={archived ? undefined : t('chat.new.title')}
            onAction={() => setComposing(true)}
          />
        }
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.center} /> : undefined}
        contentContainerStyle={items.length === 0 ? styles.grow : undefined}
      />
    );
  }

  const denied = query.error instanceof ApiRequestError && query.error.status === 403;
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.bar, { borderBottomColor: colors.border }]}>
        <Button
          label={archived ? t('chat.showActive') : t('chat.showArchived')}
          variant="ghost"
          onPress={() => setArchived((v) => !v)}
          style={styles.barBtn}
        />
        <Button label={t('chat.new.title')} onPress={() => setComposing(true)} style={styles.barBtn} disabled={denied} />
      </View>
      {content}

      <NewConversationSheet
        visible={composing}
        onClose={() => setComposing(false)}
        onCreated={(id) => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: id } })}
      />

      <SheetModal visible={!!target} onClose={() => setTarget(null)}>
        {target ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading" numberOfLines={1} accessibilityRole="header">
              {conversationTitle(target, t)}
            </Text>
            <Button
              variant="secondary"
              label={target.pinned ? t('chat.unpin') : t('chat.pin')}
              onPress={() => apply({ pinned: !target.pinned })}
            />
            {isMuted(target) ? (
              <Button variant="secondary" label={t('chat.unmute')} onPress={() => apply({ mutedUntil: null })} />
            ) : (
              <>
                <Button
                  variant="secondary"
                  label={t('chat.mute8h')}
                  onPress={() => apply({ mutedUntil: new Date(Date.now() + 8 * 3600_000).toISOString() })}
                />
                <Button variant="secondary" label={t('chat.muteAlways')} onPress={() => apply({ mutedUntil: FOREVER })} />
              </>
            )}
            <Button
              variant="secondary"
              label={target.archived ? t('chat.unarchive') : t('chat.archive')}
              onPress={() => apply({ archived: !target.archived })}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setTarget(null)} />
          </View>
        ) : null}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1, justifyContent: 'center' },
  center: { padding: spacing.xl },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barBtn: { paddingHorizontal: spacing.lg },
});
