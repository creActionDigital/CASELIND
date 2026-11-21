import type { Conversation } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SheetModal } from '../../../components/SheetModal';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { conversationTitle, fetchConversations, patchMyState } from '../../../messaging/api';
import { isMuted, patchConversation, removeConversation, type ConversationPages } from '../../../messaging/cache';
import { chatColors } from '../../../messaging/chat-theme';
import { ChatStories } from '../../../messaging/ChatStories';
import { ExploreCommunities } from '../../../messaging/ExploreCommunities';
import { GroupCards } from '../../../messaging/GroupCards';
import { ConversationRow } from '../../../messaging/ConversationRow';
import { MessageSearchPanel } from '../../../messaging/MessageSearchPanel';
import { qk } from '../../../messaging/keys';
import { NewConversationSheet } from '../../../messaging/NewConversationSheet';
import { PushCard } from '../../../notifications/PushCard';
import { brandColor, radius, shadow, spacing, TAB_BAR_SPACE, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, IconButton, Text } from '../../../ui';
import { SkeletonList } from '../../../ui/premium';

const FOREVER = '2100-01-01T00:00:00.000Z';

type Filter = 'all' | 'unread' | 'groups' | 'archived';
interface ListRow {
  key: string;
  conv?: Conversation;
  header?: string;
}

/** Onglet Messagerie : statuts, filtres en pilules, épinglées puis le reste, actions longues, nouvelle conversation. */
export default function Messages() {
  const { colors, isDark } = useTheme();
  const cc = chatColors(colors, isDark);
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [inMessages, setInMessages] = useState(false);
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

  const unreadN = archived ? 0 : items.filter((c) => c.unreadCount > 0).length;
  const q = search.trim().toLowerCase();
  const filtered = items.filter((c) => {
    if (filter === 'unread' && c.unreadCount === 0) return false;
    if (filter === 'groups' && c.kind !== 'group') return false;
    return !q || conversationTitle(c, t).toLowerCase().includes(q);
  });
  const rows: ListRow[] = [];
  const pinned = filtered.filter((c) => c.pinned);
  if (pinned.length > 0) {
    rows.push({ key: 'h-pinned', header: t('chat.section.pinned') });
    pinned.forEach((c) => rows.push({ key: c.id, conv: c }));
    const rest = filtered.filter((c) => !c.pinned);
    if (rest.length > 0) rows.push({ key: 'h-others', header: t('chat.section.others') });
    rest.forEach((c) => rows.push({ key: c.id, conv: c }));
  } else {
    filtered.forEach((c) => rows.push({ key: c.id, conv: c }));
  }

  const pills: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: t('chat.filter.all') },
    { id: 'unread', label: t('chat.filter.unread'), count: unreadN },
    { id: 'groups', label: t('chat.filter.groups') },
    { id: 'archived', label: t('chat.filter.archived') },
  ];
  const pick = (f: Filter) => {
    setFilter(f);
    setArchived(f === 'archived');
  };

  let content;
  if (query.isPending) {
    content = <SkeletonList rows={6} label={t('common.loading')} />;
  } else if (query.isError && items.length === 0) {
    // Inclut l'accès refusé (403 : messagerie désactivée ou non autorisée).
    content = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else {
    content = (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) =>
          item.conv ? (
            <ConversationRow conversation={item.conv} onPress={open} onLongPress={longPress} />
          ) : (
            <Text variant="bodyStrong" style={styles.section} accessibilityRole="header">
              {item.header}
            </Text>
          )
        }
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          archived ? undefined : (
            <>
              <PushCard />
              {filter === 'groups' && !q ? <GroupCards groups={filtered} onOpen={open} /> : null}
              {filter === 'groups' && !q ? <ExploreCommunities /> : null}
            </>
          )
        }
        ListEmptyComponent={
          items.length > 0 ? (
            <Text variant="small" muted style={styles.center}>
              {t('chat.noResults')}
            </Text>
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title={archived ? t('chat.emptyArchivedTitle') : t('messages.emptyTitle')}
              body={archived ? t('chat.emptyArchivedBody') : t('messages.emptyBody')}
              actionLabel={archived ? undefined : t('chat.new.title')}
              onAction={() => setComposing(true)}
            />
          )
        }
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.center} /> : undefined}
        contentContainerStyle={[{ paddingBottom: TAB_BAR_SPACE + 56 }, rows.length === 0 && styles.grow]}
      />
    );
  }

  const denied = query.error instanceof ApiRequestError && query.error.status === 403;
  return (
    <View style={[styles.flex, { backgroundColor: cc.bg }]}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('chat.title')}
        </Text>
        <IconButton
          icon="search"
          label={t('chat.search')}
          onPress={() => {
            setSearching((v) => !v);
            setSearch('');
          }}
          style={{ backgroundColor: cc.card }}
        />
        <IconButton icon="call-outline" label={t('md.calls.entry')} onPress={() => router.push('/calls' as never)} style={{ backgroundColor: cc.card }} />
        <IconButton icon="help-buoy-outline" label={t('md.help.title')} onPress={() => router.push('/help-requests' as never)} style={{ backgroundColor: cc.card }} />
        <IconButton icon="create-outline" label={t('chat.newMessage')} onPress={() => setComposing(true)} disabled={denied} style={{ backgroundColor: cc.card }} />
      </View>
      {searching ? (
        <TextInput
          value={search}
          onChangeText={setSearch}
          autoFocus
          accessibilityLabel={inMessages ? t('social.search.placeholder') : t('chat.searchPlaceholder')}
          placeholder={inMessages ? t('social.search.placeholder') : t('chat.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={[styles.search, typography.small, { color: colors.text, backgroundColor: cc.card }]}
        />
      ) : null}
      {searching ? (
        <View style={styles.pills}>
          {[false, true].map((mode) => (
            <Pressable
              key={String(mode)}
              accessibilityRole="button"
              accessibilityState={{ selected: inMessages === mode }}
              onPress={() => setInMessages(mode)}
              style={[styles.pill, { backgroundColor: inMessages === mode ? brandColor : cc.card }]}
            >
              <Text variant="caption" color={inMessages === mode ? '#FFFFFF' : colors.text}>
                {mode ? t('social.search.messages') : t('social.search.chats')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {searching && inMessages ? null : <ChatStories />}
      <View style={styles.pills}>
        {pills.map((p) => {
          const on = filter === p.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => pick(p.id)}
              style={[styles.pill, { backgroundColor: on ? brandColor : cc.card }]}
            >
              <Text variant="caption" color={on ? '#FFFFFF' : colors.text}>
                {p.label}
              </Text>
              {p.count ? (
                <View style={[styles.count, { backgroundColor: on ? 'rgba(255,255,255,0.28)' : brandColor }]}>
                  <Text variant="caption" color="#FFFFFF">
                    {p.count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {searching && inMessages ? (
        <MessageSearchPanel
          query={search}
          onOpen={(hit) => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: hit.conversationId, focus: hit.messageId } })}
        />
      ) : (
        content
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.new.title')}
        disabled={denied}
        onPress={() => setComposing(true)}
        style={({ pressed }) => [styles.fab, shadow.float, { backgroundColor: brandColor, opacity: denied ? 0.5 : pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>

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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: { marginHorizontal: spacing.lg, marginTop: spacing.sm, minHeight: TOUCH, borderRadius: radius.pill, paddingHorizontal: spacing.lg },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  count: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  fab: { position: 'absolute', right: spacing.lg, bottom: TAB_BAR_SPACE, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
});
