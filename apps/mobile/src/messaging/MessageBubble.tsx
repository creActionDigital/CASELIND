import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { chatColors } from './chat-theme';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Text } from '../ui';
import { messagePreview, systemText } from './api';
import { PollCard } from './PollCard';
import type { CachedMessage } from './cache';
import type { MessageStatus } from './receipts';

interface Props {
  message: CachedMessage;
  mine: boolean;
  /** Nom de l'expéditeur affiché dans un groupe (messages des autres). */
  senderName?: string;
  status?: MessageStatus;
  replyTo?: CachedMessage | null;
  name: (userId: string | null) => string;
  onLongPress: (m: CachedMessage) => void;
  onRetry: (m: CachedMessage) => void;
}

function Bubble({ message: m, mine, senderName, status, replyTo, name, onLongPress, onRetry }: Props) {
  const { colors, isDark } = useTheme();
  const cc = chatColors(colors, isDark);
  const { t, locale } = useI18n();

  if (m.kind === 'system') {
    return (
      <View style={styles.system} accessible accessibilityRole="text">
        <Text variant="caption" muted style={styles.systemText}>
          {m.systemEvent ? systemText(m.systemEvent, name, t) : ''}
        </Text>
      </View>
    );
  }

  const bg = m.recalled ? colors.surfaceAlt : mine ? cc.mineBubble : cc.theirBubble;
  const fg = m.recalled ? colors.textMuted : mine ? cc.onMine : cc.onTheirs;
  const sub = mine && !m.recalled ? cc.tick : colors.textMuted;
  const time = new Date(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const statusLabel = status ? t(`chat.status.${status}`) : '';
  const fwd = m.forwarded && !m.recalled;
  const expiry = m.expiresAt && !m.recalled ? new Date(m.expiresAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '';
  const summary = m.recalled ? t('chat.recalled') : m.kind === 'media' ? t('chat.photo') : m.kind === 'poll' ? t('social.poll.preview', { question: m.body ?? '' }) : (m.body ?? '');

  return (
    <View style={[styles.wrap, mine ? styles.right : styles.left]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${senderName ? senderName + ', ' : ''}${fwd ? t('messagesX.forwarded') + ', ' : ''}${summary}, ${time}${statusLabel ? ', ' + statusLabel : ''}${expiry ? ', ' + t('messagesX.timer', { when: expiry }) : ''}`}
        accessibilityHint={t('chat.bubbleHint')}
        onLongPress={() => onLongPress(m)}
        delayLongPress={300}
        style={[styles.bubble, mine ? styles.tailRight : styles.tailLeft, { backgroundColor: bg }]}
      >
        {senderName && !mine ? (
          <Text variant="caption" color={colors.primary} style={styles.sender}>
            {senderName}
          </Text>
        ) : null}
        {fwd ? (
          <View style={styles.fwd}>
            <Ionicons name="arrow-redo-outline" size={12} color={mine ? cc.onMine : colors.textMuted} />
            <Text variant="caption" color={mine ? cc.onMine : colors.textMuted} style={styles.italic}>
              {t('messagesX.forwarded')}
            </Text>
          </View>
        ) : null}
        {m.replyToId ? (
          <View style={[styles.quote, { borderLeftColor: mine ? cc.tick : colors.primary, backgroundColor: mine ? 'rgba(255,255,255,0.14)' : isDark ? 'rgba(255,255,255,0.07)' : colors.primarySoft }]}>
            <Text variant="caption" color={fg} numberOfLines={2}>
              {replyTo ? messagePreview(replyTo, t, name) || t('chat.photo') : t('chat.replyUnavailable')}
            </Text>
          </View>
        ) : null}
        {m.recalled ? (
          <Text variant="small" color={fg} style={styles.italic}>
            {t('chat.recalled')}
          </Text>
        ) : m.kind === 'poll' && m.poll ? (
          <PollCard message={{ ...m, poll: m.poll }} mine={mine} fg={fg} />
        ) : m.kind === 'media' ? (
          <AuthImage contentUrl={m.media?.contentUrl ?? null} localUri={m.localUri} label={t('chat.photo')} style={styles.image} />
        ) : (
          <Text color={fg} style={styles.body}>{m.body}</Text>
        )}
        {!m.recalled && m.reactions.length > 0 ? (
          <View style={styles.reactions}>
            {m.reactions.map((r) => (
              <View
                key={r.emoji}
                accessible
                accessibilityLabel={t('chat.reactionA11y', { emoji: r.emoji, n: r.count })}
                style={[styles.pill, { backgroundColor: colors.background, borderColor: m.myReaction === r.emoji ? colors.primary : colors.border }]}
              >
                <Text variant="caption">
                  {r.emoji} {r.count}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.meta}>
          {expiry ? (
            <Ionicons name="timer-outline" size={13} color={sub} accessibilityLabel={t('messagesX.timer', { when: expiry })} />
          ) : null}
          <Text variant="caption" color={sub}>
            {time}
          </Text>
          {mine && status ? <StatusIcon status={status} color={sub} tick={cc.tick} /> : null}
        </View>
      </Pressable>
      {status === 'failed' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('chat.retry')} onPress={() => onRetry(m)} style={styles.retry}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text variant="small" color={colors.danger}>
            {t('chat.retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatusIcon({ status, color, tick }: { status: MessageStatus; color: string; tick: string }) {
  const { colors } = useTheme();
  const map = {
    sending: { name: 'time-outline', color },
    failed: { name: 'alert-circle', color: colors.danger },
    sent: { name: 'checkmark', color },
    delivered: { name: 'checkmark-done', color },
    read: { name: 'checkmark-done', color: tick },
  } as const;
  const s = map[status];
  return <Ionicons name={s.name} size={14} color={s.color} />;
}

export const MessageBubble = memo(Bubble);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: 2, maxWidth: '100%' },
  right: { alignItems: 'flex-end' },
  left: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', minHeight: TOUCH - 8, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  tailRight: { borderBottomRightRadius: 6 },
  tailLeft: { borderBottomLeftRadius: 6 },
  body: { fontSize: 15, lineHeight: 21 },
  sender: { fontWeight: '700' },
  fwd: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quote: { borderLeftWidth: 3, borderRadius: radius.sm, padding: spacing.xs },
  italic: { fontStyle: 'italic' },
  image: { width: 220, height: 220 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TOUCH, paddingHorizontal: spacing.sm },
  system: { alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  systemText: { textAlign: 'center' },
});
