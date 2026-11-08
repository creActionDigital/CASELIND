import { userFlagsSchema } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../ui';
import type { ComponentProps } from 'react';

type Icon = ComponentProps<typeof Ionicons>['name'];

// Familles de modules du cahier des charges. `flag` : module réglementé, visible seulement si
// GET /v1/config/flags l'autorise pour l'utilisateur.
const MODULES: { key: MessageKey; icon: Icon; flag?: string }[] = [
  { key: 'more.miniapps', icon: 'apps-outline' },
  { key: 'more.games', icon: 'game-controller-outline' },
  { key: 'more.trading', icon: 'trending-up-outline' },
  { key: 'more.betting', icon: 'dice-outline', flag: 'betting' },
  { key: 'more.finance', icon: 'wallet-outline' },
  { key: 'more.health', icon: 'medkit-outline' },
  { key: 'more.education', icon: 'school-outline' },
  { key: 'more.travel', icon: 'airplane-outline' },
  { key: 'more.mobility', icon: 'bus-outline' },
  { key: 'more.jobs', icon: 'briefcase-outline' },
  { key: 'more.realestate', icon: 'business-outline' },
  { key: 'more.public', icon: 'business-outline' },
];

export default function More() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const flags = useQuery({
    queryKey: ['flags'],
    queryFn: () => api.request('/config/flags', { schema: userFlagsSchema }),
  });

  return (
    <Screen edges={[]}>
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
