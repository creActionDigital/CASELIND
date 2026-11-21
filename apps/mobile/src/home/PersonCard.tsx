import type { RecommendedPerson } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { setFollow } from '../social/api';
import { sk } from '../social/keys';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Button, Text } from '../ui';

/** Profil recommandé : ouvre le profil, bouton Suivre. */
export function PersonCard({ person, width }: { person: RecommendedPerson; width?: number }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [followed, setFollowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const follow = useMutation({
    mutationFn: () => setFollow(person.userId, true),
    onSuccess: () => {
      setFollowed(true);
      void qc.invalidateQueries({ queryKey: sk.feed });
      void qc.invalidateQueries({ queryKey: sk.stats(person.userId) });
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  return (
    <View style={[styles.card, width ? { width } : null, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ma.person.open', { name: person.displayName })}
        onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: person.userId } })}
        style={styles.top}
      >
        <Avatar name={person.displayName} size={56} contentUrl={person.avatarUrl} />
        <Text variant="bodyStrong" numberOfLines={1} style={styles.center}>
          {person.displayName}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          @{person.handle}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {person.mutualCount > 0 ? t('ma.person.mutual', { n: person.mutualCount }) : t('ma.person.followers', { n: person.followersCount })}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        variant={followed ? 'secondary' : 'primary'}
        label={followed ? t('profile.social.following') : t('profile.social.follow')}
        disabled={followed}
        loading={follow.isPending}
        onPress={() => follow.mutate()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderRadius: radius.md },
  top: { alignItems: 'center', gap: spacing.xs },
  center: { textAlign: 'center' },
});
