import { Ionicons } from '@expo/vector-icons';
import type { Conversation } from '@caselind/contracts';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { brandColor, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Text } from '../ui';
import { conversationTitle, formatListTime, messagePreview } from './api';
import { isMuted } from './cache';
import { chatColors } from './chat-theme';
import { useDraftText } from './extras-hooks';
import { draftPreview } from './extras-logic';

interface Props {
  conversation: Conversation;
  onPress: (c: Conversation) => void;
  onLongPress: (c: Conversation) => void;
}

function Row({ conversation: c, onPress, onLongPress }: Props) {
  const { colors, isDark } = useTheme();
  const cc = chatColors(colors, isDark);
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const title = conversationTitle(c, t);
  const muted = isMuted(c);
  const draft = useDraftText(c.id) ?? c.draft?.body ?? null;
  const draftText = draft && draft.trim() ? draftPreview(draft) : '';
  const preview = c.lastMessage ? messagePreview(c.lastMessage, t) : t('chat.noMessages');
  const mineLast = !!c.lastMessage && !!me && c.lastMessage.senderId === me.id && c.lastMessage.kind !== 'system';
  const label = [
    title,
    c.unreadCount > 0 ? t('chat.unreadA11y', { n: c.unreadCount }) : '',
    c.pinned ? t('chat.pinned') : '',
    muted ? t('chat.muted') : '',
    draftText ? t('messagesX.draftPrefix') + draftText : preview,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('chat.rowHint')}
      onPress={() => onPress(c)}
      onLongPress={() => onLongPress(c)}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? cc.card : 'transparent' }]}
    >
      <Avatar name={title} size={52} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {title}
          </Text>
          {muted ? <Ionicons name="notifications-off-outline" size={14} color={colors.textMuted} /> : null}
          {c.pinned ? <Ionicons name="pin" size={13} color={colors.textMuted} /> : null}
          <Text variant="caption" color={c.unreadCount > 0 ? brandColor : colors.textMuted} style={c.unreadCount > 0 && isDark ? { color: cc.tick } : undefined}>
            {formatListTime(c.lastActivityAt, locale)}
          </Text>
        </View>
        <View style={styles.line}>
          {mineLast && !draftText ? <Ionicons name="checkmark-done" size={15} color={cc.tick === '#C7D2FE' ? brandColor : cc.tick} /> : null}
          <Text variant="small" muted numberOfLines={1} style={[styles.flex, c.lastMessage?.recalled && styles.italic]}>
            {draftText ? (
              <>
                <Text variant="small" color={colors.primary}>
                  {t('messagesX.draftPrefix')}
                </Text>
                {draftText}
              </>
            ) : (
              preview
            )}
          </Text>
          {c.unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: muted ? colors.surfaceAlt : brandColor }]} importantForAccessibility="no-hide-descendants">
              <Text variant="caption" color={muted ? colors.textMuted : '#FFFFFF'}>
                {c.unreadCount > 99 ? '99+' : String(c.unreadCount)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ConversationRow = memo(Row);

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH + 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    marginHorizontal: spacing.sm,
  },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
