import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchBadges, fetchLeaderboard, fetchTournament, fetchTournaments, gameKeys } from '../../../games/api';
import { useI18n } from '../../../i18n';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/** Quiz éclair : règles, bouton Jouer et classement (semaine ou depuis toujours). Jeu d'adresse, sans argent. */
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

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('games.title') }} />
      <View style={styles.body}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="heading">{t('games.quiz')}</Text>
          <Text variant="small" muted>
            {t('games.intro')}
          </Text>
          <Button label={t('games.play')} onPress={() => router.push('/games/play')} />
        </View>
        <Text variant="heading" accessibilityRole="header">
          {t('games.badges')}
        </Text>
        {badges.data?.items.map((b) => (
          <View key={b.key} style={[styles.row, { backgroundColor: colors.surface }]}>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{t(`games.badge.${b.key}`)}</Text>
              <Text variant="small" muted>
                {b.progress}/{b.target}
              </Text>
            </View>
            {b.earned ? <Badge tone="neutral" label={t('games.badge.earned')} /> : null}
          </View>
        ))}
        <Text variant="heading" accessibilityRole="header">
          {t('games.tournaments')}
        </Text>
        <Text variant="small" muted>
          {t('games.tournaments.note')}
        </Text>
        {tournaments.data?.items.length === 0 ? <Text muted>{t('games.tournaments.empty')}</Text> : null}
        {tournaments.data?.items.map((x) => (
          <View key={x.id} style={styles.gap}>
            <Button label={`${x.title} · ${t(`games.tournament.${x.status}`)}`} variant="secondary" onPress={() => setOpenId(openId === x.id ? null : x.id)} />
            {openId === x.id ? ranking.data?.items.map((i) => <Row key={i.handle} i={i} />) : null}
          </View>
        ))}
        <Text variant="heading" accessibilityRole="header">
          {t('games.leaderboard')}
        </Text>
        <Chips
          options={[
            { value: 'week' as const, label: t('games.week') },
            { value: 'all' as const, label: t('games.all') },
          ]}
          value={period}
          onChange={setPeriod}
          scroll={false}
        />
        {board.isError ? <ErrorState error={board.error} onRetry={() => board.refetch()} /> : null}
        {board.data?.items.length === 0 ? <Text muted>{t('games.empty')}</Text> : null}
        {board.data?.items.map((i) => (
          <Row key={i.handle} i={i} />
        ))}
      </View>
    </Screen>
  );
}

type RankItem = { rank: number; displayName: string; handle: string; bestScore: number; me: boolean };
function Row({ i }: { i: RankItem }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.row, { backgroundColor: i.me ? colors.primarySoft : colors.surface }]}>
      <Text variant="bodyStrong">{i.rank}</Text>
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {i.displayName}
        </Text>
        <Text variant="small" muted>
          @{i.handle}
        </Text>
      </View>
      {i.me ? <Badge tone="neutral" label={t('games.you')} /> : null}
      <Text variant="bodyStrong">{t('games.points', { n: i.bestScore })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  body: { gap: spacing.md },
  flex: { flex: 1 },
  card: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
});
