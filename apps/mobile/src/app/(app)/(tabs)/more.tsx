import { userFlagsSchema } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { hasAdminAccess } from '../../../admin/console-logic';
import { api, useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { radius, spacing, TAB_BAR_SPACE } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../ui';
import type { ComponentProps } from 'react';

type Icon = ComponentProps<typeof Ionicons>['name'];

// Entrées sans drapeau de module : chemin, libellé, icône.
const EXTRA_TILES: { path: string; label: MessageKey; icon: Icon }[] = [
  { path: '/wishlist', label: 'wish.open', icon: 'heart-outline' },
  { path: '/courier', label: 'courier.title', icon: 'cube-outline' },
  { path: '/work', label: 'work.title', icon: 'briefcase-outline' },
  { path: '/downloads', label: 'dig.downloads.title', icon: 'download-outline' },
  { path: '/creator', label: 'creator.tile.dashboard', icon: 'bar-chart-outline' },
  { path: '/bookmarks', label: 'creator.tile.bookmarks', icon: 'bookmark-outline' },
  { path: '/my-sanctions', label: 'ops2.mine.title', icon: 'shield-half-outline' },
  { path: '/announcements', label: 'ops2.annUser.title', icon: 'notifications-outline' },
  { path: '/carpool', label: 'carpool.title', icon: 'people-outline' },
  { path: '/rentals', label: 'rentals.title', icon: 'car-sport-outline' },
  { path: '/roadside', label: 'roadside.title', icon: 'build-outline' },
];

// Familles de modules du cahier des charges. `flag` : module réglementé, visible seulement si
// GET /v1/config/flags l'autorise pour l'utilisateur.
const MODULES: { key: MessageKey; icon: Icon; flag?: string }[] = [
  { key: 'more.travel', icon: 'airplane-outline' },
  { key: 'more.public', icon: 'business-outline' },
];

export default function More() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { me } = useAuth();
  const flags = useQuery({
    queryKey: ['flags'],
    queryFn: () => api.request('/config/flags', { schema: userFlagsSchema }),
  });

  return (
    <Screen edges={[]} bottomSpace={TAB_BAR_SPACE}>
      <Text variant="title" accessibilityRole="header">
        {t('more.title')}
      </Text>
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('more.intro')}
      </Text>
      {flags.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : flags.isError ? (
        <ErrorState error={flags.error} onRetry={() => flags.refetch()} />
      ) : (
        <View style={styles.grid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobility.title')}
            onPress={() => router.push('/rides')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="car-sport-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('mobility.title')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('shop.title')}
            onPress={() => router.push('/shop')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="bag-handle-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('shop.title')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('services.title')}
            onPress={() => router.push('/services')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="construct-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('services.title')}
            </Text>
          </Pressable>
          {flags.data.flags.listings !== false ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('listings.title')}
              onPress={() => router.push('/listings')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="pricetags-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('listings.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.games !== false ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('games.title')}
              onPress={() => router.push('/games')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="game-controller-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('games.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.school === true ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('school.title')}
              onPress={() => router.push('/school')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="school-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('school.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.health === true ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('health.title')}
              onPress={() => router.push('/health')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="medkit-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('health.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.education !== false ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('education.title')}
              onPress={() => router.push('/education')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="school-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('education.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.freelance !== false ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('freelance.title')}
              onPress={() => router.push('/freelance')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="hammer-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('freelance.title')}
              </Text>
            </Pressable>
          ) : null}
          {flags.data.flags.jobs !== false ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('jobs.title')}
              onPress={() => router.push('/jobs')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="briefcase-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('jobs.title')}
              </Text>
            </Pressable>
          ) : null}
          {EXTRA_TILES.map((x) => (
            <Pressable
              key={x.path}
              accessibilityRole="button"
              accessibilityLabel={t(x.label)}
              onPress={() => router.push(x.path as never)}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name={x.icon} size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t(x.label)}
              </Text>
            </Pressable>
          ))}
          {hasAdminAccess(me?.roles) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('adm.hub.title')}
              onPress={() => router.push('/admin')}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="shield-checkmark-outline" size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                {t('adm.hub.title')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ai.tile')}
            onPress={() => router.push('/ai')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="sparkles-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('ai.tile')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('miniapps.title')}
            onPress={() => router.push('/miniapps')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="apps-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('miniapps.title')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('more.finance')}
            onPress={() => router.push('/wallet/finance')}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="wallet-outline" size={26} color={colors.primary} />
            <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
              {t('more.finance')}
            </Text>
          </Pressable>
          {MODULES.filter((m) => !m.flag || flags.data.flags[m.flag] === true).map((m) => (
            <View
              key={m.key}
              accessible
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={`${t(m.key)}, ${t('common.soon')}`}
              style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name={m.icon} size={26} color={colors.primary} />
              <Text variant="small" style={{ textAlign: 'center' }}>
                {t(m.key)}
              </Text>
              <Badge tone="neutral" label={t('common.soon')} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    width: '30%',
    flexGrow: 1,
    minHeight: 104,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
});
