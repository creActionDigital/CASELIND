import { Ionicons } from '@expo/vector-icons';
import type { Message } from '@caselind/contracts';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useAuth } from '../../../auth/auth-context';
import { SheetModal } from '../../../components/SheetModal';
import { openReport } from '../../../report/open-report';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { uuidv4 } from '../../../lib/uuid';
import { imageMime, uploadMessageImage } from '../../../media/upload';
import {
  conversationTitle,
  fetchConversation,
  fetchMembers,
  fetchMessages,
  messagePreview,
  postMessage,
  postReceipt,
} from '../../../messaging/api';
import {
  applyMessageToConversation,
  applyReadState,
  buildOptimisticMessage,
  displayMessages,
  markRecalled,
  newestServerSeq,
  oldestSeq,
  outboxAdd,
  outboxMark,
  outboxRemove,
  removeMessage,
  upsertServerMessage,
  type CachedMessage,
  type ConversationPages,
  type MessagePages,
  type Outbox,
} from '../../../messaging/cache';
import { useExpiryTimer } from '../../../messaging/extras-hooks';
import {
  deleteDraft,
  extrasKeys,
  fetchDraft,
  fetchScheduled,
  saveDraft,
  scheduleMessage,
  setFavorite,
} from '../../../messaging/extras-api';
import { createDebouncer, DRAFT_DEBOUNCE_MS, shouldApplyRemoteDraft } from '../../../messaging/extras-logic';
import { ForwardSheet } from '../../../messaging/ForwardSheet';
import { qk } from '../../../messaging/keys';
import { ScheduleSheet } from '../../../messaging/ScheduleSheet';
import { MessageBubble } from '../../../messaging/MessageBubble';
import { receiptsFromMembers, receiptStatus, type ReceiptMap } from '../../../messaging/receipts';
import { useRealtime, useTypingUsers } from '../../../realtime/realtime-context';
import { radius, spacing, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, IconButton, Text } from '../../../ui';

const BODY_MAX = 4000;
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Salon : historique inversé, envoi optimiste, accusés, saisie en cours, réponses, réactions, rappel, images. */
export default function ChatRoom() {
  const { conversationId, focus } = useLocalSearchParams<{ conversationId: string; focus?: string }>();
  const id = String(conversationId);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const myId = me?.id ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const { emitTyping, setActiveConversation, connected } = useRealtime();
  const typingUsers = useTypingUsers(id);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<CachedMessage | null>(null);
  const [actions, setActions] = useState<CachedMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [forwardId, setForwardId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [favOverrides, setFavOverrides] = useState<Map<string, boolean>>(() => new Map());
  const listRef = useRef<FlatList<CachedMessage>>(null);
  const focused_ = useRef<string | null>(null);
  const lastSaved = useRef<string | null>(null);
  const draftRestored = useRef(false);

  const conv = useQuery({ queryKey: qk.conversation(id), queryFn: () => fetchConversation(id) });
  const members = useQuery({ queryKey: qk.members(id), queryFn: () => fetchMembers(id) });
  const history = useInfiniteQuery({
    queryKey: qk.messages(id),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => fetchMessages(id, pageParam),
    getNextPageParam: (last) => (last.hasMore ? oldestSeq(last) : undefined),
  });
  const outboxQ = useQuery<Outbox>({ queryKey: ['outbox', id], queryFn: () => [], enabled: false, initialData: [] });
  const draftKey = extrasKeys.draft(id);
  const draftQ = useQuery<string | null>({
    queryKey: draftKey,
    queryFn: async () => (await fetchDraft(id))?.body ?? null,
    staleTime: Infinity,
  });
  const scheduledQ = useQuery({ queryKey: extrasKeys.scheduled, queryFn: fetchScheduled });
  const receiptsQ = useQuery<ReceiptMap>({ queryKey: qk.receipts(id), queryFn: () => ({}), enabled: false, initialData: {} });

  // Initialise les positions de lecture depuis la liste des membres (sans reculer).
  useEffect(() => {
    if (!members.data) return;
    const seed = receiptsFromMembers(members.data.items, myId);
    qc.setQueryData<ReceiptMap>(qk.receipts(id), (prev) => {
      const next: ReceiptMap = { ...prev };
      for (const [uid, pos] of Object.entries(seed)) {
        const cur = next[uid];
        next[uid] = cur ? { delivered: Math.max(cur.delivered, pos.delivered), read: pos.read === null ? cur.read : Math.max(cur.read ?? 0, pos.read) } : pos;
      }
      return next;
    });
  }, [members.data, myId, id, qc]);

  // Salon visible : les nouveaux messages n'incrémentent pas les non-lus.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setActiveConversation(id);
      return () => {
        setFocused(false);
        setActiveConversation(null);
      };
    }, [id, setActiveConversation]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Brouillon : enregistrement anti-rebond (800 ms), vidé quand le champ l'est, flush en quittant le salon.
  const drafter = useMemo(
    () =>
      createDebouncer((body: string) => {
        if (!body.trim()) {
          lastSaved.current = null;
          qc.setQueryData<string | null>(draftKey, null);
          deleteDraft(id).catch(() => undefined);
        } else {
          lastSaved.current = body;
          qc.setQueryData<string | null>(draftKey, body);
          saveDraft(id, body).catch(() => undefined);
        }
      }, DRAFT_DEBOUNCE_MS),
    [id, qc, draftKey],
  );
  useEffect(() => () => drafter.flush(), [drafter]);
  useEffect(() => {
    draftRestored.current = false;
    lastSaved.current = null;
  }, [id]);
  useEffect(() => {
    if (draftQ.data === undefined) return;
    if (!draftRestored.current) {
      // Restauration à l'ouverture (sans écraser ce qui a déjà été tapé).
      draftRestored.current = true;
      lastSaved.current = draftQ.data;
      if (draftQ.data && !text) setText(draftQ.data);
      return;
    }
    // Brouillon venu d'un autre appareil (draft.updated).
    if (shouldApplyRemoteDraft({ remote: draftQ.data, current: text, lastSaved: lastSaved.current, hasPendingSave: drafter.pending() })) {
      lastSaved.current = draftQ.data;
      setText(draftQ.data ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ.data]);

  const data = history.data as MessagePages | undefined;
  const items = useMemo(() => displayMessages(data, outboxQ.data), [data, outboxQ.data]);
  useExpiryTimer(id, items);
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const names = useMemo(() => new Map((members.data?.items ?? []).map((m) => [m.userId, m.displayName])), [members.data]);
  const nameOf = useCallback(
    (userId: string | null) => (userId === myId ? t('chat.you') : ((userId && names.get(userId)) || t('chat.unknownUser'))),
    [names, myId, t],
  );

  // Marque lu quand l'écran est visible et qu'un message plus récent est arrivé.
  const newest = newestServerSeq(data);
  const lastRead = useRef(0);
  useEffect(() => {
    lastRead.current = 0;
  }, [id]);
  useEffect(() => {
    if (!focused || !active || newest <= lastRead.current) return;
    lastRead.current = newest;
    void qc.invalidateQueries({ queryKey: extrasKeys.scheduled });
    postReceipt(id, 'read', newest).then(
      (state) => qc.setQueriesData<ConversationPages>({ queryKey: qk.conversationsAll }, (d) => applyReadState(d, state)),
      () => {
        lastRead.current = 0; // nouvel essai au prochain événement
      },
    );
  }, [focused, active, newest, id, qc]);

  useEffect(() => {
    if (!focus || focused_.current === focus) return;
    const index = items.findIndex((m) => m.id === focus);
    if (index < 0) return;
    focused_.current = focus;
    const handle = setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }), 150);
    return () => clearTimeout(handle);
  }, [focus, items]);

  const setOutbox = (fn: (o: Outbox | undefined) => Outbox) => qc.setQueryData<Outbox>(['outbox', id], fn);

  const deliver = useCallback(
    async (m: CachedMessage) => {
      try {
        let mediaId: string | undefined;
        if (m.kind === 'media') {
          if (!m.localUri) throw new Error('no local file');
          mediaId = await uploadMessageImage(m.localUri, imageMime(m.localMime, m.localUri));
        }
        const server: Message = await postMessage(id, {
          clientId: m.clientId!,
          kind: m.kind === 'media' ? 'media' : 'text',
          body: m.kind === 'media' ? undefined : (m.body ?? ''),
          mediaId,
          replyToId: m.replyToId ?? undefined,
        });
        qc.setQueryData<MessagePages>(qk.messages(id), (d) => upsertServerMessage(d, server));
        qc.setQueriesData<ConversationPages>({ queryKey: qk.conversationsAll }, (d) =>
          applyMessageToConversation(d, server, { myId, openConversationId: id }),
        );
        setOutbox((o) => outboxRemove(o, m.clientId!));
      } catch (err) {
        setOutbox((o) => outboxMark(o, m.clientId!, 'failed'));
        setNotice(errorMessage(err, t, locale));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, myId, qc, t, locale],
  );

  function send() {
    const body = text.trim();
    if (!body) return;
    const msg = buildOptimisticMessage({ conversationId: id, senderId: myId, clientId: uuidv4(), kind: 'text', body, replyToId: replyTo?.id });
    setText('');
    drafter.cancel();
    lastSaved.current = null;
    qc.setQueryData<string | null>(draftKey, null);
    setReplyTo(null);
    setNotice(null);
    setOutbox((o) => outboxAdd(o, msg));
    void deliver(msg);
  }

  async function schedule(at: Date) {
    const body = text.trim();
    if (!body) return setScheduling(false);
    setSchedBusy(true);
    try {
      await scheduleMessage(id, { clientId: uuidv4(), body, scheduledAt: at.toISOString(), replyToId: replyTo?.id });
      // 202 : pas de bulle ; la ligne « Programmé pour … » vient de la liste des programmés.
      setText('');
      setReplyTo(null);
      drafter.cancel();
      lastSaved.current = null;
      qc.setQueryData<string | null>(draftKey, null);
      void qc.invalidateQueries({ queryKey: extrasKeys.scheduled });
      setNotice(null);
    } catch (err) {
      setNotice(errorMessage(err, t, locale));
    } finally {
      setSchedBusy(false);
      setScheduling(false);
    }
  }

  function isFavorite(m: CachedMessage): boolean {
    const override = favOverrides.get(m.id);
    if (override !== undefined) return override;
    if (m.favorited) return true;
    const cached = qc.getQueryData<InfiniteData<{ items: { message: { id: string } }[] }>>(extrasKeys.favorites);
    return !!cached?.pages.some((p) => p.items.some((f) => f.message.id === m.id));
  }

  async function toggleFavorite(m: CachedMessage) {
    const on = !isFavorite(m);
    setActions(null);
    try {
      await setFavorite(m.id, on);
      setFavOverrides((s) => new Map(s).set(m.id, on));
      void qc.invalidateQueries({ queryKey: extrasKeys.favorites });
    } catch (err) {
      setNotice(errorMessage(err, t, locale));
    }
  }

  async function attach() {
    setNotice(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset) return;
      const msg = buildOptimisticMessage({
        conversationId: id,
        senderId: myId,
        clientId: uuidv4(),
        kind: 'media',
        replyToId: replyTo?.id,
        localUri: asset.uri,
        localMime: asset.mimeType ?? undefined,
      });
      setReplyTo(null);
      setOutbox((o) => outboxAdd(o, msg));
      void deliver(msg);
    } catch (err) {
      setNotice(errorMessage(err, t, locale));
    }
  }

  function retry(m: CachedMessage) {
    setNotice(null);
    setOutbox((o) => outboxAdd(o, m)); // même clientId
    void deliver({ ...m, local: 'sending' });
  }

  async function react(m: CachedMessage, emoji: string) {
    setActions(null);
    try {
      await api.request(`/messages/${m.id}/reaction`, { method: 'PUT', body: { emoji: m.myReaction === emoji ? null : emoji } });
      if (!connected) void qc.invalidateQueries({ queryKey: qk.messages(id) });
    } catch (err) {
      setNotice(errorMessage(err, t, locale));
    }
  }

  async function recall(m: CachedMessage) {
    setActions(null);
    try {
      await api.request(`/messages/${m.id}`, { method: 'DELETE', query: { scope: 'all' } });
      qc.setQueryData<MessagePages>(qk.messages(id), (d) => markRecalled(d, m.id));
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
    } catch (err) {
      const late = err instanceof ApiRequestError && err.status === 409;
      setNotice(late ? t('error.recall_window_elapsed') : errorMessage(err, t, locale));
    }
  }

  async function hide(m: CachedMessage) {
    setActions(null);
    if (m.local) return setOutbox((o) => outboxRemove(o, m.clientId!));
    try {
      await api.request(`/messages/${m.id}`, { method: 'DELETE', query: { scope: 'me' } });
      qc.setQueryData<MessagePages>(qk.messages(id), (d) => removeMessage(d, m.id));
    } catch (err) {
      setNotice(errorMessage(err, t, locale));
    }
  }

  const others = Object.entries(receiptsQ.data)
    .filter(([uid]) => uid !== myId)
    .map(([, p]) => p);
  const title = conv.data ? conversationTitle(conv.data, t) : t('messages.room');
  const typingNames = typingUsers.filter((u) => u !== myId).map((u) => names.get(u) ?? t('chat.unknownUser'));

  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: conv.data
          ? () => (
              <IconButton
                icon="information-circle-outline"
                label={conv.data.kind === 'group' ? t('chat.groupInfo') : t('messagesX.info')}
                onPress={() =>
                  conv.data.kind === 'group'
                    ? router.push({ pathname: '/group/[conversationId]', params: { conversationId: id } })
                    : router.push({ pathname: '/chat-info/[conversationId]', params: { conversationId: id } })
                }
              />
            )
          : undefined,
      }}
    />
  );

  if (conv.isPending || (history.isPending && !history.isError)) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {header}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </SafeAreaView>
    );
  }
  if (conv.isError || history.isError) {
    const error = conv.error ?? history.error;
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
        {header}
        <ErrorState error={error} onRetry={() => (conv.isError ? conv.refetch() : history.refetch())} />
      </SafeAreaView>
    );
  }

  const mySched = (scheduledQ.data?.items ?? []).filter((s) => s.conversationId === id);
  const peerGone = conv.data.kind === 'direct' && !conv.data.peer;
  const isGroup = conv.data.kind === 'group';
  const actionsMine = !!actions && actions.senderId === myId;

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        ref={listRef}
        style={styles.flex}
        inverted
        data={items}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => {
          const mine = item.senderId === myId;
          return (
            <MessageBubble
              message={item}
              mine={mine}
              senderName={isGroup && !mine && item.senderId ? nameOf(item.senderId) : undefined}
              status={mine && item.kind !== 'system' ? receiptStatus(item, others) : undefined}
              replyTo={item.replyToId ? (byId.get(item.replyToId) ?? null) : null}
              name={nameOf}
              onLongPress={setActions}
              onRetry={retry}
            />
          );
        }}
        onScrollToIndexFailed={() => undefined}
        ListHeaderComponent={
          mySched.length > 0 ? (
            <View>
              {mySched.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('messagesX.schedule.at', { when: new Date(s.scheduledAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}, ${s.body ?? t('messagesX.scheduled.media')}`}
                  onPress={() => router.push({ pathname: '/scheduled', params: { conversationId: id } })}
                  style={[styles.sched, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}
                >
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  <View style={styles.flex}>
                    <Text variant="caption" color={colors.primary}>
                      {t('messagesX.schedule.at', { when: new Date(s.scheduledAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}
                    </Text>
                    <Text variant="small" numberOfLines={1}>
                      {s.body ?? t('messagesX.scheduled.media')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : undefined
        }
        onEndReached={() => history.hasNextPage && !history.isFetchingNextPage && history.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={history.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : undefined}
        ListEmptyComponent={
          // FlatList inversée : le vide est retourné pour rester lisible.
          <View style={styles.flip}>
            <EmptyState icon="chatbubble-ellipses-outline" title={t('chat.room.emptyTitle')} body={t('chat.room.emptyBody')} />
          </View>
        }
        keyboardShouldPersistTaps="handled"
      />

      {typingNames.length > 0 ? (
        <Text variant="caption" muted style={styles.typing} accessibilityLiveRegion="polite">
          {t(typingNames.length === 1 ? 'chat.typing.one' : 'chat.typing.many', { name: typingNames[0] })}
        </Text>
      ) : null}
      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setNotice(null)} style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive">
            {notice}
          </Text>
        </Pressable>
      ) : null}
      {replyTo ? (
        <View style={[styles.reply, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border }]}>
          <View style={styles.flex}>
            <Text variant="caption" color={colors.primary}>
              {t('chat.replyingTo', { name: nameOf(replyTo.senderId) })}
            </Text>
            <Text variant="small" muted numberOfLines={1}>
              {messagePreview(replyTo, t, nameOf)}
            </Text>
          </View>
          <IconButton icon="close" label={t('chat.cancelReply')} onPress={() => setReplyTo(null)} />
        </View>
      ) : null}

      {peerGone ? (
        <Text variant="small" muted style={styles.typing}>
          {t('chat.peerGone')}
        </Text>
      ) : (
        <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <IconButton icon="image-outline" label={t('chat.attach')} onPress={attach} color={colors.primary} />
          <View style={styles.flex}>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                drafter.call(v);
                if (v) emitTyping(id);
              }}
              accessibilityLabel={t('chat.input')}
              placeholder={t('chat.input')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={BODY_MAX}
              style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
            />
            {text.length > BODY_MAX - 500 ? (
              <Text variant="caption" muted style={styles.count}>
                {text.length}/{BODY_MAX}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.send')}
            accessibilityHint={t('messagesX.schedule.hint')}
            accessibilityState={{ disabled: !text.trim() }}
            accessibilityActions={[{ name: 'schedule', label: t('messagesX.schedule.action') }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'schedule' && text.trim() && setScheduling(true)}
            disabled={!text.trim()}
            onPress={send}
            onLongPress={() => setScheduling(true)}
            delayLongPress={400}
            hitSlop={4}
            style={({ pressed }) => [styles.sendBtn, { opacity: !text.trim() ? 0.5 : pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="send" size={24} color={colors.primary} />
          </Pressable>
        </View>
      )}

      <ForwardSheet messageId={forwardId} onClose={() => setForwardId(null)} />
      <ScheduleSheet visible={scheduling} onClose={() => setScheduling(false)} onConfirm={schedule} busy={schedBusy} />

      <SheetModal visible={!!actions} onClose={() => setActions(null)}>
        {actions ? (
          <View style={{ gap: spacing.sm }}>
            {!actions.local && !actions.recalled && actions.kind !== 'system' ? (
              <View style={styles.emojis}>
                {EMOJIS.map((e) => (
                  <Pressable
                    key={e}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat.react', { emoji: e })}
                    accessibilityState={{ selected: actions.myReaction === e }}
                    onPress={() => react(actions, e)}
                    style={[styles.emoji, actions.myReaction === e && { backgroundColor: colors.primarySoft }]}
                  >
                    <Text variant="title">{e}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!actions.local && !actions.recalled && actions.kind !== 'system' ? (
              <Button
                variant="secondary"
                label={t('chat.reply')}
                onPress={() => {
                  setReplyTo(actions);
                  setActions(null);
                }}
              />
            ) : null}
            {!actions.local && !actions.recalled && actions.kind !== 'system' ? (
              <>
                <Button
                  variant="secondary"
                  label={t('messagesX.forward')}
                  onPress={() => {
                    setForwardId(actions.id);
                    setActions(null);
                  }}
                />
                <Button
                  variant="secondary"
                  label={isFavorite(actions) ? t('messagesX.fav.remove') : t('messagesX.fav.add')}
                  onPress={() => toggleFavorite(actions)}
                />
              </>
            ) : null}
            {actionsMine && !actions.local && !actions.recalled ? (
              <Button variant="secondary" label={t('chat.recall')} onPress={() => recall(actions)} />
            ) : null}
            {!actionsMine && !actions.local && actions.kind !== 'system' ? (
              <Button
                variant="secondary"
                label={t('report.action')}
                onPress={() => {
                  const id = actions.id;
                  setActions(null);
                  openReport({ targetType: 'message', targetId: id });
                }}
              />
            ) : null}
            <Button variant="secondary" label={actions.local ? t('chat.discard') : t('chat.hide')} onPress={() => hide(actions)} />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setActions(null)} />
          </View>
        ) : null}
      </SheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.lg },
  flip: { transform: [{ scaleY: -1 }] },
  typing: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  notice: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  reply: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: TOUCH, maxHeight: 140, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  sched: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginVertical: 2, padding: spacing.sm, borderWidth: 1, borderRadius: radius.md },
  count: { textAlign: 'right', marginTop: 2 },
  emojis: { flexDirection: 'row', justifyContent: 'space-between' },
  emoji: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
