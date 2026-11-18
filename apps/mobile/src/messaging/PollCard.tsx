import type { Conversation, Message, Poll } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { applyMessageUpdated, type MessagePages } from './cache';
import { qk } from './keys';
import { closePoll, votePoll } from './social-api';
import { canClosePoll, nextVotes, optionPercent, totalVotes, withMyVotes } from './social-logic';

interface Props {
  message: Message & { poll: Poll };
  mine: boolean;
  /** Couleur du texte de la bulle. */
  fg: string;
}

/** Sondage dans une bulle : options votables (changer ou retirer son vote), résultats agrégés anonymes, clôture. */
export function PollCard({ message: m, mine, fg }: Props) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Le serveur (réponse ou événement) reprend la main dès que la bulle est rafraîchie.
  useEffect(() => setLocal(null), [m.poll]);
  const poll = local ?? m.poll;
  const total = totalVotes(poll);
  const role = qc.getQueryData<Conversation>(qk.conversation(m.conversationId))?.myRole ?? 'member';
  const canClose = canClosePoll({ senderId: m.senderId, poll }, me?.id ?? '', role);

  const apply = (msg: Message) => qc.setQueryData<MessagePages>(qk.messages(m.conversationId), (d) => applyMessageUpdated(d, msg));

  async function vote(optionId: string) {
    if (poll.closed) return;
    const votes = nextVotes(poll, poll.myVotes, optionId);
    setLocal(withMyVotes(poll, votes));
    setError(null);
    try {
      apply(await votePoll(m.id, votes));
    } catch (err) {
      setLocal(null);
      setError(errorMessage(err, t, locale));
    }
  }
  async function close() {
    setError(null);
    try {
      apply(await closePoll(m.id));
    } catch (err) {
      setError(errorMessage(err, t, locale));
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Ionicons name="stats-chart" size={14} color={fg} />
        <Text variant="caption" color={fg}>
          {t('social.poll.badge')} · {poll.multiple ? t('social.poll.multi') : t('social.poll.single')}
        </Text>
      </View>
      <Text color={fg} style={styles.question}>
        {poll.question}
      </Text>
      {poll.options.map((o) => {
        const chosen = poll.myVotes.includes(o.id);
        const pct = optionPercent(o.votes, total);
        return (
          <Pressable
            key={o.id}
            disabled={poll.closed}
            accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: chosen, disabled: poll.closed }}
            accessibilityLabel={t('social.poll.option.a11y', { label: o.label, votes: o.votes, pct })}
            onPress={() => void vote(o.id)}
            style={[styles.option, { borderColor: chosen ? colors.primary : colors.border, backgroundColor: colors.background }]}
          >
            <View style={[styles.bar, { width: `${pct}%`, backgroundColor: colors.primarySoft }]} />
            <Ionicons name={chosen ? (poll.multiple ? 'checkbox' : 'radio-button-on') : poll.multiple ? 'square-outline' : 'radio-button-off'} size={18} color={chosen ? colors.primary : colors.textMuted} />
            <Text style={styles.label} numberOfLines={3}>
              {o.label}
            </Text>
            <Text variant="caption" muted>
              {o.votes}
            </Text>
          </Pressable>
        );
      })}
      <Text variant="caption" color={fg}>
        {t('social.poll.voters', { n: poll.voters })} · {t('social.poll.anonymous')}
        {poll.closed ? ` · ${t('social.poll.closed')}` : ''}
      </Text>
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {canClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('social.poll.close')} onPress={() => void close()} style={styles.close}>
          <Text variant="small" color={mine ? fg : colors.primary}>
            {t('social.poll.close')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, minWidth: 230 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  question: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  option: { minHeight: TOUCH - 4, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  label: { flex: 1 },
  close: { minHeight: TOUCH - 8, justifyContent: 'center', alignSelf: 'flex-start' },
});
