import type { Comment } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { clickAdPost } from '../../../ads/api';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { createComment, deleteComment, fetchComments, fetchPost } from '../../../social/api';
import { patchPostEverywhere } from '../../../social/hooks';
import { sk } from '../../../social/keys';
import { formatRelativeTime, groupComments, type CommentThread } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { radius, spacing, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, EmptyState, ErrorState, IconButton, Text } from '../../../ui';

const MAX = 2000;

/** Détail d'une publication : publication, commentaires paginés (plus anciens d'abord), réponses sur un niveau. */
export default function PostDetail() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const id = String(postId);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const post = useQuery({ queryKey: sk.post(id), queryFn: () => fetchPost(id) });
  // Ouvrir une publication promue compte comme un clic de la campagne (le serveur ignore tout autre cas).
  useEffect(() => {
    void clickAdPost(id).catch(() => undefined);
  }, [id]);
  const comments = useInfiniteQuery({
    queryKey: sk.comments(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchComments(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => comments.data?.pages.flatMap((p) => p.items) ?? [], [comments.data]);
  const threads = useMemo(() => groupComments(items), [items]);

  const send = useMutation({
    mutationFn: (v: { body: string; replyToId?: string }) => createComment(id, v.body, v.replyToId),
    onSuccess: (c) => {
      setText('');
      setReplyTo(null);
      setNotice(null);
      qc.setQueryData<typeof comments.data>(sk.comments(id), (d) => {
        if (!d || d.pages.length === 0) return d;
        const last = d.pages.length - 1;
        return { ...d, pages: d.pages.map((pg, i) => (i === last ? { ...pg, items: [...pg.items.filter((x) => x.id !== c.id), c] } : pg)) };
      });
      patchPostEverywhere(qc, id, (p) => ({ ...p, commentsCount: p.commentsCount + 1 }));
    },
    onError: (e) => setNotice(errorMessage(e, t, locale)),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sk.comments(id) });
      void qc.invalidateQueries({ queryKey: sk.post(id) });
      void qc.invalidateQueries({ queryKey: sk.feed });
    },
    onError: (e) => setNotice(errorMessage(e, t, locale)),
  });

  const header = <Stack.Screen options={{ title: t('post.title') }} />;

  if (post.isPending) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {header}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </SafeAreaView>
    );
  }
  if (post.isError) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
        {header}
        <ErrorState error={post.error} onRetry={() => post.refetch()} />
      </SafeAreaView>
    );
  }

  const canDelete = (c: Comment) => me?.id === c.author.id || me?.id === post.data.author.id;

  const renderComment = (c: Comment, nested: boolean) => (
    <View key={c.id} style={[styles.comment, nested && styles.nested]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={c.author.displayName}
        onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: c.author.id } })}
        style={styles.avatarHit}
      >
        <Avatar name={c.author.displayName} size={nested ? 28 : 34} />
      </Pressable>
      <View style={styles.flex}>
        <View style={[styles.bubble, { backgroundColor: colors.surfaceAlt }]}>
          <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
            {c.author.displayName}
          </Text>
          <Text variant="small" muted={c.moderation === 'hidden'}>
            {c.moderation === 'hidden' ? t('post.hiddenComment') : c.body}
          </Text>
        </View>
        <View style={styles.cmeta}>
          <Text variant="caption" muted>
            {formatRelativeTime(c.createdAt, locale)}
          </Text>
          {!nested ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('post.reply')} ${c.author.displayName}`} onPress={() => setReplyTo(c)} style={styles.link}>
              <Text variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
                {t('post.reply')}
              </Text>
            </Pressable>
          ) : null}
          {canDelete(c) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('post.deleteComment')} onPress={() => remove.mutate(c.id)} style={styles.link}>
              <Text variant="caption" color={colors.danger} style={{ fontWeight: '600' }}>
                {t('feed.delete')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate({ body, replyToId: replyTo ? (replyTo.replyToId ?? replyTo.id) : undefined });
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
        <FlatList<CommentThread<Comment>>
          style={styles.flex}
          data={threads}
          keyExtractor={(th) => th.comment.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <PostCard post={post.data} detail />
              {comments.isPending ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
              {comments.isError ? <ErrorState error={comments.error} onRetry={() => comments.refetch()} /> : null}
              {!comments.isPending && !comments.isError && threads.length === 0 ? (
                <EmptyState icon="chatbubbles-outline" title={t('feed.comments')} body={t('post.noComments')} />
              ) : null}
            </View>
          }
          renderItem={({ item: th }) => (
            <View>
              {renderComment(th.comment, false)}
              {th.replies.map((r) => renderComment(r, true))}
            </View>
          )}
          ListFooterComponent={
            comments.hasNextPage ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('post.loadMore')} onPress={() => comments.fetchNextPage()} style={styles.loadMore}>
                {comments.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text color={colors.primary} variant="small" style={{ fontWeight: '600' }}>
                    {t('post.loadMore')}
                  </Text>
                )}
              </Pressable>
            ) : undefined
          }
        />
        {notice ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setNotice(null)} style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive">
              {notice}
            </Text>
          </Pressable>
        ) : null}
        {replyTo ? (
          <View style={[styles.reply, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border }]}>
            <Text variant="caption" color={colors.primary} style={styles.flex} numberOfLines={1}>
              {t('post.replyTo', { name: replyTo.author.displayName })}
            </Text>
            <IconButton icon="close" label={t('post.cancelReply')} onPress={() => setReplyTo(null)} />
          </View>
        ) : null}
        <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX}
            accessibilityLabel={t('post.commentPlaceholder')}
            placeholder={t('post.commentPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <IconButton icon="send" label={t('post.send')} onPress={submit} disabled={!text.trim() || send.isPending} color={colors.primary} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.xl },
  comment: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  nested: { paddingLeft: spacing.lg + 42 },
  avatarHit: { minWidth: 34, minHeight: 34 },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  cmeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: TOUCH - 8 },
  link: { minHeight: TOUCH - 8, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  loadMore: { minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  notice: { padding: spacing.md },
  reply: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 120, minHeight: TOUCH, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10 },
});
