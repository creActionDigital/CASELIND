import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { SheetModal } from '../components/SheetModal';
import { useI18n, type MessageKey } from '../i18n';
import { errorMessage } from '../lib/errors';
import { openReport } from '../report/open-report';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Button, Text } from '../ui';
import { useDeletePost, useEditPost, useReact } from './hooks';
import { formatRelativeTime, nextReaction, REACTION_TYPES, totalReactions, type CachedPost } from './logic';
import { PostMedia, type MediaItem } from './PostMedia';
import { discardPublish, retryPublish } from './publisher';
import type { ReactionType } from './types';
import { VisibilityPicker, visibilityIcon, visibilityKey } from './VisibilityPicker';

type Icon = ComponentProps<typeof Ionicons>['name'];

export const REACTION_ICON: Record<ReactionType, Icon> = {
  like: 'thumbs-up',
  love: 'heart',
  haha: 'happy',
  wow: 'sparkles',
  sad: 'sad',
  angry: 'flame',
};

const COLLAPSED_LINES = 6;
const LONG_TEXT = 280;

interface Props {
  post: CachedPost;
  /** Écran de détail : texte complet, pas de lien vers soi-même. */
  detail?: boolean;
}

export const PostCard = memo(function PostCard({ post, detail }: Props) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const react = useReact(post);

  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<'closed' | 'main' | 'delete' | 'edit'>('closed');

  const mine = me?.id === post.author.id;
  const local = !!post.local;
  const total = totalReactions(post.reactions);
  const body = post.body ?? '';
  const long = body.length > LONG_TEXT || body.split('\n').length > COLLAPSED_LINES;

  const media: MediaItem[] = local
    ? (post.localMedia ?? []).map((m, i) => ({ key: `l${i}`, mime: m.mime, contentUrl: null, localUri: m.uri }))
    : post.media.map((m) => ({ key: m.id, mime: m.mime, contentUrl: m.contentUrl }));

  const openAuthor = () => router.push({ pathname: '/user/[userId]', params: { userId: post.author.id } });
  const openPost = () => router.push({ pathname: '/post/[postId]', params: { postId: post.id } });
  const mark = (type: ReactionType | null) => {
    setPicking(false);
    react.mutate(type);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.author', { name: post.author.displayName })}
          onPress={openAuthor}
          style={styles.author}
        >
          <Avatar name={post.author.displayName} size={40} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {post.author.displayName}
            </Text>
            <View style={styles.meta}>
              <Text variant="caption" muted numberOfLines={1} style={styles.flexShrink}>
                @{post.author.handle} · {formatRelativeTime(post.createdAt, locale)}
              </Text>
              <Ionicons name={visibilityIcon[post.visibility]} size={12} color={colors.textMuted} accessibilityLabel={t(visibilityKey(post.visibility))} />
            </View>
          </View>
        </Pressable>
        {local ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('feed.menu')}
            onPress={() => setMenu('main')}
            hitSlop={4}
            style={styles.iconBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {post.moderation === 'hidden' ? (
        <View style={[styles.notice, { backgroundColor: colors.dangerSoft }]}>
          <Text variant="caption" color={colors.danger}>
            {t('feed.hidden')}
          </Text>
        </View>
      ) : null}

      {body ? (
        <View>
          <Text numberOfLines={detail || expanded ? undefined : COLLAPSED_LINES} selectable={detail}>
            {body}
          </Text>
          {long && !detail ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? t('feed.seeLess') : t('feed.seeMore')}
              onPress={() => setExpanded((v) => !v)}
              style={styles.more}
            >
              <Text color={colors.primary} variant="small" style={{ fontWeight: '600' }}>
                {expanded ? t('feed.seeLess') : t('feed.seeMore')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <PostMedia items={media} />

      {local ? (
        <View style={styles.status}>
          {post.local === 'sending' ? (
            <>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round((post.progress ?? 0) * 100) }}
                accessibilityLabel={t('feed.sending')}
                style={[styles.track, { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={[styles.fillBar, { backgroundColor: colors.primary, width: `${Math.max(6, Math.round((post.progress ?? 0) * 100))}%` }]} />
              </View>
              <Text variant="caption" muted>
                {t('feed.sending')}
              </Text>
            </>
          ) : (
            <>
              <Text variant="small" color={colors.danger}>
                {t('feed.failed')}
              </Text>
              <View style={styles.row}>
                <Button label={t('feed.retry')} onPress={() => retryPublish(qc, post.id)} style={styles.smallBtn} />
                <Button label={t('feed.discard')} variant="ghost" onPress={() => discardPublish(qc, post.id, post.author.id)} style={styles.smallBtn} />
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${post.myReaction ? t(`feed.reaction.${post.myReaction}` as MessageKey) : t('feed.react')}, ${t('feed.reactions', { n: total })}`}
            accessibilityHint={t('feed.reactA11y')}
            accessibilityState={{ selected: !!post.myReaction }}
            onPress={() => mark(post.myReaction ? null : 'like')}
            onLongPress={() => setPicking(true)}
            style={styles.action}
          >
            <Ionicons
              name={post.myReaction ? REACTION_ICON[post.myReaction] : 'thumbs-up-outline'}
              size={22}
              color={post.myReaction ? colors.primary : colors.textMuted}
            />
            {total > 0 ? (
              <Text variant="small" color={post.myReaction ? colors.primary : colors.textMuted}>
                {total}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('feed.commentsCount', { n: post.commentsCount })}
            onPress={openPost}
            disabled={detail}
            style={styles.action}
          >
            <Ionicons name="chatbubble-outline" size={21} color={colors.textMuted} />
            {post.commentsCount > 0 ? (
              <Text variant="small" color={colors.textMuted}>
                {post.commentsCount}
              </Text>
            ) : null}
          </Pressable>
        </View>
      )}

      {picking ? (
        <View style={[styles.picker, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityViewIsModal>
          {REACTION_TYPES.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              accessibilityLabel={t(`feed.reaction.${r}` as MessageKey)}
              onPress={() => mark(nextReaction(post.myReaction, r))}
              style={styles.pick}
            >
              <Ionicons name={REACTION_ICON[r]} size={24} color={post.myReaction === r ? colors.primary : colors.text} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setPicking(false)} style={styles.pick}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <PostMenu
        post={post}
        mine={mine}
        state={menu}
        setState={setMenu}
        onDeleted={() => {
          if (detail) router.back();
        }}
      />
    </View>
  );
});

function PostMenu({
  post,
  mine,
  state,
  setState,
  onDeleted,
}: {
  post: CachedPost;
  mine: boolean;
  state: 'closed' | 'main' | 'delete' | 'edit';
  setState: (s: 'closed' | 'main' | 'delete' | 'edit') => void;
  onDeleted: () => void;
}) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const del = useDeletePost(post.id);
  const edit = useEditPost(post.id);
  const [text, setText] = useState(post.body ?? '');
  const [vis, setVis] = useState(post.visibility);
  const close = () => setState('closed');
  const canClear = post.media.length > 0;
  const trimmed = text.trim();
  const invalid = trimmed.length === 0 && !canClear;

  const item = (icon: Icon, label: string, onPress: () => void, danger?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.menuItem}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <Text color={danger ? colors.danger : undefined}>{label}</Text>
    </Pressable>
  );

  return (
    <SheetModal visible={state !== 'closed'} onClose={close}>
      {state === 'main' ? (
        <View>
          {mine ? (
            <>
              {item('create-outline', t('feed.edit'), () => {
                setText(post.body ?? '');
                setVis(post.visibility);
                setState('edit');
              })}
              {item('trash-outline', t('feed.delete'), () => setState('delete'), true)}
            </>
          ) : (
            item('flag-outline', t('feed.report'), () => {
              close();
              openReport({ targetType: 'post', targetId: post.id });
            })
          )}
        </View>
      ) : null}
      {state === 'delete' ? (
        <View style={styles.gap}>
          <Text variant="heading" accessibilityRole="header">
            {t('feed.deleteTitle')}
          </Text>
          <Text muted>{t('feed.deleteBody')}</Text>
          {del.isError ? <Text color={colors.danger}>{errorMessage(del.error, t, locale)}</Text> : null}
          <Button
            variant="danger"
            label={t('feed.delete')}
            loading={del.isPending}
            onPress={() =>
              del.mutate(undefined, {
                onSuccess: () => {
                  close();
                  onDeleted();
                },
              })
            }
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={close} />
        </View>
      ) : null}
      {state === 'edit' ? (
        <View style={styles.gap}>
          <Text variant="heading" accessibilityRole="header">
            {t('feed.editTitle')}
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={5000}
            accessibilityLabel={t('compose.placeholder')}
            placeholder={t('compose.placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <VisibilityPicker value={vis} onChange={setVis} />
          {edit.isError ? <Text color={colors.danger}>{errorMessage(edit.error, t, locale)}</Text> : null}
          <Button
            label={t('common.save')}
            loading={edit.isPending}
            disabled={invalid}
            onPress={() =>
              edit.mutate({ body: trimmed.length ? trimmed : null, visibility: vis }, { onSuccess: close })
            }
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={close} />
        </View>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  card: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  more: { minHeight: TOUCH, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { minHeight: TOUCH, minWidth: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: spacing.md },
  picker: {
    position: 'absolute',
    left: spacing.lg,
    bottom: TOUCH + spacing.xs,
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    zIndex: 5,
    elevation: 6,
  },
  pick: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  status: { gap: spacing.sm },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fillBar: { height: 4, borderRadius: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  smallBtn: { minHeight: TOUCH, paddingHorizontal: spacing.lg },
  menuItem: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gap: { gap: spacing.md },
  input: { minHeight: 110, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, textAlignVertical: 'top' },
});
