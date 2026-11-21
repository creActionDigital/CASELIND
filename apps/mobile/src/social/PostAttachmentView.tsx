import { Ionicons } from '@expo/vector-icons';
import type { Post } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { directionsUrl, type MapsPlatform } from '../places/geo';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { votePostPoll } from './api';
import { patchPostEverywhere } from './hooks';
import { pollPercent } from './logic';
import { sk } from './keys';

const platform: MapsPlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

/** Pièce jointe d'une publication : événement, localisation (itinéraire) ou sondage (vote, résultats en direct). */
export function PostAttachmentView({ post }: { post: Pick<Post, 'id' | 'attachment'> }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const a = post.attachment;
  const vote = useMutation({
    mutationFn: (i: number) => votePostPoll(post.id, i),
    onSuccess: (p) => {
      qc.setQueryData(sk.post(p.id), p);
      patchPostEverywhere(qc, p.id, (x) => ({ ...x, attachment: p.attachment }));
    },
  });
  if (!a) return null;
  const box = [styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }];

  if (a.type === 'event') {
    const when = new Date(a.startsAt).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
    return (
      <View style={box} accessible accessibilityLabel={`${t('mb.attach.event')}: ${a.title}, ${when}`}>
        <Ionicons name="calendar-outline" size={22} color={colors.primary} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{a.title}</Text>
          <Text variant="small" muted>
            {when}
          </Text>
          {a.place ? (
            <Text variant="small" muted>
              {a.place}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  if (a.type === 'location') {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('mb.attach.openMap', { place: a.label })}
        onPress={() => void Linking.openURL(directionsUrl(platform, { lat: a.lat, lng: a.lng, label: a.label })).catch(() => undefined)}
        style={box}
      >
        <Ionicons name="location" size={22} color={colors.primary} />
        <Text variant="bodyStrong" style={styles.flex}>
          {a.label}
        </Text>
        <Text variant="small" color={colors.primary}>
          {t('places.directions')}
        </Text>
      </Pressable>
    );
  }
  const total = a.options.reduce((n, o) => n + o.votes, 0);
  return (
    <View style={{ gap: spacing.xs }}>
      {a.options.map((o, i) => {
        const pct = pollPercent(o.votes, total);
        const mine = a.myVote === i;
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityState={{ selected: mine }}
            accessibilityLabel={`${o.label}, ${pct}%`}
            disabled={vote.isPending}
            onPress={() => vote.mutate(i)}
            style={[styles.opt, { borderColor: mine ? colors.primary : colors.border }]}
          >
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.primarySoft }]} />
            <Text style={styles.flex}>{o.label}</Text>
            <Text variant="small" muted>
              {pct}%
            </Text>
          </Pressable>
        );
      })}
      <Text variant="caption" muted accessibilityLiveRegion="polite">
        {vote.isError ? t('mb.poll.error') : t('mb.poll.votes', { n: total })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, minHeight: TOUCH },
  opt: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
