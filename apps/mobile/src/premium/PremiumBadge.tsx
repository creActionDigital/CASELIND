import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { brandAccent, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { fetchPremiumBadge } from './api';

/** Badge « Premium » d'un compte (rien si le compte n'est pas abonné). Seul « Premium ou non » est public. */
export function PremiumBadge({ userId }: { userId: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ['premium-badge', userId], queryFn: () => fetchPremiumBadge(userId), staleTime: 120_000 });
  if (!q.data?.premium) return null;
  return (
    <View accessible accessibilityLabel={t('mon.premium.badgeA11y')} style={[styles.badge, { backgroundColor: brandAccent }]}>
      <Ionicons name="ribbon" size={14} color={colors.onAccent} />
      <Text variant="caption" color={colors.onAccent} style={{ fontWeight: '700' }}>
        {t('mon.premium.badge')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.md },
});
