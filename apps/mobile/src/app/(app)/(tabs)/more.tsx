import { userFlagsSchema } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { hasAdminAccess } from '../../../admin/console-logic';
import { api, useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { serviceVisible, type ServiceEntry, SERVICE_SECTIONS, type Icon } from '../../../menu/services';
import { radius, spacing, TAB_BAR_SPACE } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../ui';
import { FadeInView, SectionHeader, ServiceGrid, Skeleton } from '../../../ui/premium';

// Familles prévues, pas encore ouvertes : tuiles « Bientôt ».
const COMING: { key: MessageKey; icon: Icon; flag?: string }[] = [
  { key: 'more.travel', icon: 'airplane-outline' },
  { key: 'more.public', icon: 'business-outline' },
];

/** Plus : centre de services, portail en sections de tuiles animées ; squelette pendant le chargement des drapeaux. */
export default function More() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { me } = useAuth();
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api.request('/config/flags', { schema: userFlagsSchema }) });
  const visible = (e: ServiceEntry) => serviceVisible(e, flags.data?.flags);

  return (
    <Screen edges={[]} bottomSpace={TAB_BAR_SPACE}>
      <Text variant="title" accessibilityRole="header">
        {t('more.title')}
      </Text>
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('more.intro')}
      </Text>
      {flags.isPending ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} style={styles.grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={styles.cell}>
              <Skeleton width={56} height={56} rounded={28} />
            </View>
          ))}
        </View>
      ) : flags.isError ? (
        <ErrorState error={flags.error} onRetry={() => flags.refetch()} />
      ) : (
        <View>
          {SERVICE_SECTIONS.map((s, si) => {
            const entries = s.entries.filter(visible);
            const extra = s.title === 'ma.more.tools' && hasAdminAccess(me?.roles);
            if (entries.length === 0 && !extra) return null;
            return (
              <FadeInView key={s.title} index={si} style={{ marginBottom: spacing.lg }}>
                <SectionHeader title={t(s.title)} />
                <ServiceGrid
                  items={[
                    ...entries.map((e) => ({ id: e.path, icon: e.icon, label: t(e.label), accent: e.accent || undefined, onPress: () => router.push(e.path as never) })),
                    ...(extra ? [{ id: '/admin', icon: 'shield-checkmark-outline' as Icon, label: t('adm.hub.title'), onPress: () => router.push('/admin') }] : []),
                  ]}
                />
              </FadeInView>
            );
          })}
          <SectionHeader title={t('ma.more.soon')} />
          <View style={styles.grid}>
            {COMING.filter((m) => !m.flag || flags.data.flags[m.flag] === true).map((m) => (
              <View
                key={m.key}
                accessible
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                accessibilityLabel={`${t(m.key)}, ${t('common.soon')}`}
                style={[styles.cell, styles.soon]}
              >
                <View style={[styles.soonBox, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name={m.icon} size={26} color={colors.textMuted} />
                </View>
                <Text variant="caption" muted style={{ textAlign: 'center' }} numberOfLines={2}>
                  {t(m.key)}
                </Text>
                <Badge tone="neutral" label={t('common.soon')} />
              </View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  cell: { width: '25%', alignItems: 'center' },
  soon: { gap: spacing.xs + 2, opacity: 0.8 },
  soonBox: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
