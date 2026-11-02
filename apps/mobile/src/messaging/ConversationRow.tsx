import { Ionicons } from '@expo/vector-icons';
import type { Conversation } from '@caselind/contracts';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Badge, Text } from '../ui';
import { conversationTitle, formatListTime, messagePreview } from './api';
import { isMuted } from './cache';

interface Props {
  conversation: Conversation;
  onPress: (c: Conversation) => void;
  onLongPress: (c: Conversation) => void;
}

function Row({ conversation: c, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const title = conversationTitle(c, t);
  const muted = isMuted(c);
  const preview = c.lastMessage ? messagePreview(c.lastMessage, t) : t('chat.noMessages');
  const label = [
    title,
    c.unreadCount > 0 ? t('chat.unreadA11y', { n: c.unreadCount }) : '',
    c.pinned ? t('chat.pinned') : '',
    muted ? t('chat.muted') : '',
    preview,
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
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceAlt : colors.background, borderBottomColor: colors.border }]}
    >
      <Avatar name={title} size={48} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {title}
          </Text>
          {c.pinned ? <Ionicons name="pin" size={14} color={colors.textMuted} /> : null}
          {muted ? <Ionicons name="notifications-off-outline" size={14} color={colors.textMuted} /> : null}
          <Text variant="caption" muted>
            {formatListTime(c.lastActivityAt, locale)}
          </Text>
        </View>
        <View style={styles.line}>
          <Text variant="small" muted numberOfLines={1} style={[styles.flex, c.lastMessage?.recalled && styles.italic]}>
            {preview}
          </Text>
          {c.unreadCount > 0 ? <Badge label={c.unreadCount > 99 ? '99+' : String(c.unreadCount)} tone={muted ? 'neutral' : 'primary'} /> : null}
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
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
});
