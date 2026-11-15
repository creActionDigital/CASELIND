import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchLeaderboard, gameKeys } from '../../../games/api';
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
          <View key={i.handle} style={[styles.row, { backgroundColor: i.me ? colors.primarySoft : colors.surface }]}>
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
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  flex: { flex: 1 },
  card: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.md },
});
