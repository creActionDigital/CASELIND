import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchBadges, fetchLeaderboard, fetchTournament, fetchTournaments, gameKeys } from '../../../games/api';
import { useI18n } from '../../../i18n';
import { brandAccent, radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';
import { Chip, ChipRow, FadeInView, PressableScale, ProgressBar, SectionHeader, SkeletonList } from '../../../ui/premium';

/** Niveau = 1 + badges obtenus : une progression sans argent ni récompense monétaire. */
const levelOf = (earned: number) => 1 + earned;

/** Jeux et défis : carte du quiz éclair, niveau, défis avec progression, tournois, classement. Aucune monnaie. */
export default function Games() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<'week' | 'all'>('week');
  const [openId, setOpenId] = useState<string | null>(null);
  const badges = useQuery({ queryKey: gameKeys.badges, queryFn: fetchBadges });
  const tournaments = useQuery({ queryKey: gameKeys.tournaments, queryFn: fetchTournaments });
  const ranking = useQuery({ queryKey: gameKeys.tournament(openId ?? ''), queryFn: () => fetchTournament(openId!), enabled: openId !== null });
  const board = useQuery({ queryKey: gameKeys.leaderboard(period), queryFn: () => fetchLeaderboard(period) });
  const earned = badges.data?.items.filter((b) => b.earned).length ?? 0;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('games.title') }} />
      <View style={styles.body}>
        <FadeInView>
          <View style={[styles.hero, { backgroundColor: colors.primary }]}>
            <View style={styles.heroTop}>
              <View style={[styles.heroIcon, { backgroundColor: colors.onPrimary }]}>
                <Ionicons name="flash" size={26} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text variant="heading" color={colors.onPrimary}>{t('games.quiz')}</Text>
                <Text variant="small" color={colors.onPrimary}>{t('md.games.level', { n: levelOf(earned) })}</Text>
              </View>
            </View>
            <Text variant="small" color={colors.onPrimary}>{t('games.intro')}</Text>
            <PressableScale accessibilityRole="button" accessibilityLabel={t('games.play')} onPress={() => router.push('/games/play')} style={[styles.play, { backgroundColor: colors.onPrimary }]}>
              <Ionicons name="play" size={18} color={colors.primary} />
              <Text variant="bodyStrong" color={colors.primary}>{t('games.play')}</Text>
            </PressableScale>
          </View>
        </FadeInView>

        <SectionHeader title={t('md.games.challenges')} />
        <Text variant="small" muted>{t('md.games.levelHint')}</Text>
        {badges.isPending ? <SkeletonList rows={3} label={t('common.loading')} /> : null}
        {badges.isError ? <ErrorState error={badges.error} onRetry={() => void badges.refetch()} /> : null}
        {badges.data?.items.map((b, i) => (
          <FadeInView key={b.key} index={i}>
            <View style={[styles.row, { backgroundColor: colors.surface }]}>
              <View style={[styles.medal, { backgroundColor: b.earned ? brandAccent : colors.surfaceAlt }]}>
                <Ionicons name={b.earned ? 'trophy' : 'trophy-outline'} size={20} color={b.earned ? '#FFFFFF' : colors.textMuted} />
              </View>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{t(`games.badge.${b.key}`)}</Text>
                <ProgressBar value={b.target > 0 ? Math.min(1, b.progress / b.target) : 0} label={`${b.progress}/${b.target}`} />
                <Text variant="caption" muted>{b.progress}/{b.target}</Text>
              </View>
              {b.earned ? <Badge tone="neutral" label={t('games.badge.earned')} /> : null}
            </View>
          </FadeInView>
        ))}

        <SectionHeader title={t('games.tournaments')} />
        <Text variant="small" muted>{t('games.tournaments.note')}</Text>
        {tournaments.isPending ? <SkeletonList rows={2} label={t('common.loading')} /> : null}
        {tournaments.isError ? <ErrorState error={tournaments.error} onRetry={() => void tournaments.refetch()} /> : null}
        {tournaments.data?.items.length === 0 ? <Text muted>{t('games.tournaments.empty')}</Text> : null}
        {tournaments.data?.items.map((x) => (
          <View key={x.id} style={styles.gap}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${x.title} · ${t(`games.tournament.${x.status}`)}`}
              onPress={() => setOpenId(openId === x.id ? null : x.id)}
              style={[styles.row, { backgroundColor: colors.surface }]}
            >
              <Ionicons name="ribbon-outline" size={22} color={colors.primary} />
              <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>{x.title}</Text>
              <Badge tone="neutral" label={t(`games.tournament.${x.status}`)} />
              <Ionicons name={openId === x.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </PressableScale>
            {openId === x.id ? ranking.data?.items.map((i) => <Row key={i.handle} i={i} />) : null}
          </View>
        ))}

        <SectionHeader title={t('games.leaderboard')} />
        <ChipRow>
          <Chip label={t('games.week')} selected={period === 'week'} onPress={() => setPeriod('week')} />
          <Chip label={t('games.all')} selected={period === 'all'} onPress={() => setPeriod('all')} />
        </ChipRow>
        {board.isPending ? <SkeletonList rows={4} label={t('common.loading')} /> : null}
        {board.isError ? <ErrorState error={board.error} onRetry={() => void board.refetch()} /> : null}
        {board.data?.items.length === 0 ? <Text muted>{t('games.empty')}</Text> : null}
        {board.data?.items.map((i, k) => (
          <FadeInView key={i.handle} index={k}>
            <Row i={i} />
          </FadeInView>
        ))}
      </View>
    </Screen>
  );
}

type RankItem = { rank: number; displayName: string; handle: string; bestScore: number; me: boolean };
function Row({ i }: { i: RankItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const top = i.rank <= 3;
  return (
    <View style={[styles.row, { backgroundColor: i.me ? colors.primarySoft : colors.surface }]}>
      <View style={[styles.rank, { backgroundColor: top ? brandAccent : colors.surfaceAlt }]}>
        <Text variant="bodyStrong" color={top ? '#FFFFFF' : colors.text}>{i.rank}</Text>
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>{i.displayName}</Text>
        <Text variant="small" muted>@{i.handle}</Text>
      </View>
      {i.me ? <Badge tone="neutral" label={t('games.you')} /> : null}
      <Text variant="bodyStrong">{t('games.points', { n: i.bestScore })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  body: { gap: spacing.md },
  flex: { flex: 1, gap: spacing.xs },
  hero: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  play: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md },
  medal: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rank: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
