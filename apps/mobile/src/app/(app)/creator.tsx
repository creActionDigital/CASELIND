import type { CreatorOverviewQuery } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BarChart } from '../../admin-ops/BarChart';
import { fetchOverview, fetchTrending } from '../../creator/api';
import { seriesPoints, type CreatorMetric } from '../../creator/logic';
import { useI18n, type MessageKey } from '../../i18n';
import { formatMoney } from '../../shop/format';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { ErrorState, Text } from '../../ui';
import { SandboxBanner } from '../../wallet/ui';

const RANGES: CreatorOverviewQuery['days'][] = [7, 30, 90];
const METRICS: CreatorMetric[] = ['impressions', 'uniqueViewers', 'reactions', 'comments', 'newFollowers'];

/** Tableau de bord créateur : portée, engagement, abonnés, pourboires reçus et boosts (mode test : argent fictif). Aucun spectateur n'est identifié. */
export default function CreatorDashboard() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [days, setDays] = useState<CreatorOverviewQuery['days']>(7);
  const q = useQuery({ queryKey: ['creator-overview', days], queryFn: () => fetchOverview(days) });
  const trending = useQuery({ queryKey: ['hashtags-trending'], queryFn: fetchTrending, staleTime: 60_000 });
  const o = q.data;
  const card = (label: string, value: number) => (
    <View key={label} accessible accessibilityLabel={`${label} : ${value}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Stack.Screen options={{ title: t('creator.dash.title') }} />
      <SandboxBanner />
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('creator.dash.range', { n: days })}>
        {RANGES.map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ selected: days === n }}
            accessibilityLabel={t('creator.dash.days', { n })}
            onPress={() => setDays(n)}
            style={[styles.chip, { borderColor: days === n ? colors.primary : colors.border, backgroundColor: days === n ? colors.primarySoft : 'transparent' }]}
          >
            <Text color={days === n ? colors.primary : undefined}>{t('creator.dash.days', { n })}</Text>
          </Pressable>
        ))}
      </View>

      {q.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {o ? (
        <>
          {o.totals.impressions + o.totals.reactions + o.totals.comments + o.totals.newFollowers === 0 ? <Text muted>{t('creator.dash.empty')}</Text> : null}
          <View style={styles.grid}>
            {card(t('creator.dash.impressions'), o.totals.impressions)}
            {card(t('creator.dash.uniqueViewers'), o.totals.uniqueViewers)}
            {card(t('creator.dash.reactions'), o.totals.reactions)}
            {card(t('creator.dash.comments'), o.totals.comments)}
            {card(t('creator.dash.bookmarks'), o.totals.bookmarks)}
            {card(t('creator.dash.newFollowers'), o.totals.newFollowers)}
          </View>
          {METRICS.map((m) => (
            <BarChart key={m} title={t(`creator.dash.${m}` as MessageKey)} points={seriesPoints(o.series, m)} />
          ))}

          <Text variant="heading" accessibilityRole="header">
            {t('creator.dash.top')}
          </Text>
          {o.topPosts.map((p) => (
            <Pressable
              key={p.postId}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: p.postId } })}
              style={[styles.card, styles.full, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text numberOfLines={2}>{p.excerpt ?? t('creator.dash.noExcerpt')}</Text>
              <Text variant="caption" muted>
                {t('creator.dash.topLine', { impressions: p.impressions, reactions: p.reactions, comments: p.comments })}
              </Text>
            </Pressable>
          ))}

          <Text variant="heading" accessibilityRole="header">
            {t('creator.dash.tips')}
          </Text>
          {o.tipsReceived.length === 0 ? <Text muted>{t('creator.dash.noTips')}</Text> : null}
          {o.tipsReceived.map((x) => (
            <Text key={x.currency}>{t('creator.dash.tipsLine', { amount: formatMoney(x.totalMinor, x.currency, locale), n: x.count })}</Text>
          ))}

          <Text variant="heading" accessibilityRole="header">
            {t('creator.dash.boosts')}
          </Text>
          {o.boosts.length === 0 ? <Text muted>{t('creator.dash.noBoosts')}</Text> : null}
          {o.boosts.map((b) => (
            <View key={b.id} style={[styles.card, styles.full, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text variant="bodyStrong">{t(`creator.dash.status.${b.status}` as MessageKey)}</Text>
              <Text variant="caption" muted>
                {t('creator.dash.boostLine', { amount: formatMoney(b.budgetMinor, b.currency, locale), date: new Date(b.endsAt).toLocaleDateString(locale), impressions: b.impressions })}
              </Text>
            </View>
          ))}
          <Text variant="caption" muted>
            {t('creator.dash.privacy')}
          </Text>
        </>
      ) : null}

      <Text variant="heading" accessibilityRole="header">
        {t('creator.trending.title')}
      </Text>
      {trending.data && trending.data.items.length === 0 ? <Text muted>{t('creator.trending.empty')}</Text> : null}
      <View style={styles.row}>
        {(trending.data?.items ?? []).map((h) => (
          <Pressable
            key={h.tag}
            accessibilityRole="link"
            accessibilityLabel={`#${h.tag}, ${t('creator.trending.count', { n: h.postsCount })}`}
            onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: h.tag } })}
            style={[styles.chip, { borderColor: colors.border }]}
          >
            <Text color={colors.primary}>#{h.tag}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, minWidth: '47%', flexGrow: 1, gap: 2 },
  full: { minWidth: '100%' },
  chip: { paddingHorizontal: spacing.lg, minHeight: 44, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1 },
});
