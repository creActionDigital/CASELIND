import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { fetchTrending } from '../../creator/api';
import { discoverKeys, fetchMerchants, fetchPeople } from '../../home/discover-api';
import { PersonCard } from '../../home/PersonCard';
import { SectionHeader } from '../../home/parts';
import { useI18n, type MessageKey } from '../../i18n';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Avatar, EmptyState, ErrorState, Screen, Text } from '../../ui';

/** Découvrir : profils recommandés, commerçants recommandés et tendances (hashtags des dernières 24 h). */
export default function Discover() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const people = useQuery({ queryKey: discoverKeys.people(20), queryFn: () => fetchPeople(20) });
  const merchants = useQuery({ queryKey: discoverKeys.merchants(20), queryFn: () => fetchMerchants(20) });
  const trends = useQuery({ queryKey: ['trending-24'], queryFn: fetchTrending });
  const loading = (q: { isPending: boolean }) => (q.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.discover.title') }} />
      <SectionHeader title={t('ma.discover.people')} />
      {loading(people)}
      {people.isError ? <ErrorState error={people.error} onRetry={() => people.refetch()} /> : null}
      {people.data && people.data.items.length === 0 ? <Text muted>{t('ma.discover.peopleEmpty')}</Text> : null}
      <View style={styles.grid}>
        {people.data?.items.map((p) => (
          <View key={p.userId} style={styles.cell}>
            <PersonCard person={p} />
          </View>
        ))}
      </View>

      <SectionHeader title={t('ma.discover.merchants')} />
      {loading(merchants)}
      {merchants.isError ? <ErrorState error={merchants.error} onRetry={() => merchants.refetch()} /> : null}
      {merchants.data && merchants.data.items.length === 0 ? <Text muted>{t('ma.discover.merchantsEmpty')}</Text> : null}
      {merchants.data?.items.map((m) => (
        <Pressable
          key={m.orgId}
          accessibilityRole="button"
          accessibilityLabel={m.name}
          onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: m.slug } })}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Avatar name={m.name} size={44} contentUrl={m.logoUrl} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {m.name}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {m.city ?? t(`ma.kind.${m.kind}` as MessageKey)}
            </Text>
          </View>
          {m.verified ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} accessibilityLabel={t('ma.discover.verified')} /> : null}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}

      <SectionHeader title={t('ma.discover.trends')} />
      {loading(trends)}
      {trends.isError ? <ErrorState error={trends.error} onRetry={() => trends.refetch()} /> : null}
      {trends.data && trends.data.items.length === 0 ? <EmptyState icon="trending-up-outline" title={t('creator.trending.empty')} /> : null}
      <View style={styles.tags}>
        {trends.data?.items.map((h) => (
          <Pressable
            key={h.tag}
            accessibilityRole="link"
            accessibilityLabel={`#${h.tag}, ${t('creator.trending.count', { n: h.postsCount })}`}
            onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: h.tag } })}
            style={[styles.tag, { backgroundColor: colors.primarySoft }]}
          >
            <Text variant="small" color={colors.primary}>
              #{h.tag}
            </Text>
            <Text variant="caption" muted>
              {t('creator.trending.count', { n: h.postsCount })}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  cell: { width: '47%', flexGrow: 1 },
  row: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.pill, justifyContent: 'center' },
});
