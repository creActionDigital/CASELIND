import { userFlagsSchema } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { hasAdminAccess } from '../../../admin/console-logic';
import { api, useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { brandAccent, radius, spacing, TAB_BAR_SPACE } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../ui';
import { FadeInView, ServiceTile, Skeleton } from '../../../ui/premium';

type Icon = ComponentProps<typeof Ionicons>['name'];
/** `on` : visible seulement si le drapeau est activé ; `notOff` : visible sauf s'il est désactivé ; absent : toujours. */
interface Entry {
  path: string;
  label: MessageKey;
  icon: Icon;
  flag?: string;
  on?: boolean;
  accent?: boolean;
}
interface Section {
  title: MessageKey;
  entries: Entry[];
}

// Portail de l'écosystème : sections (cahier des charges), un drapeau masque les modules réglementés ou coupés.
const SECTIONS: Section[] = [
  {
    title: 'ma.more.everyday',
    entries: [
      { path: '/shop', label: 'shop.title', icon: 'bag-handle-outline' },
      { path: '/wishlist', label: 'wish.open', icon: 'heart-outline' },
      { path: '/downloads', label: 'dig.downloads.title', icon: 'download-outline' },
      { path: '/services', label: 'services.title', icon: 'construct-outline' },
      { path: '/listings', label: 'listings.title', icon: 'home-outline', flag: 'listings' },
      { path: '/games', label: 'games.title', icon: 'game-controller-outline', flag: 'games' },
    ],
  },
  {
    title: 'ma.more.travel',
    entries: [
      { path: '/rides', label: 'mobility.title', icon: 'car-sport-outline' },
      { path: '/carpool', label: 'carpool.title', icon: 'people-outline' },
      { path: '/rentals', label: 'rentals.title', icon: 'key-outline' },
      { path: '/roadside', label: 'roadside.title', icon: 'build-outline' },
      { path: '/courier', label: 'courier.title', icon: 'cube-outline' },
    ],
  },
  {
    title: 'ma.more.money',
    entries: [
      { path: '/wallet/finance', label: 'more.finance', icon: 'wallet-outline' },
      { path: '/creator', label: 'creator.tile.dashboard', icon: 'bar-chart-outline' },
      { path: '/premium', label: 'mon.premium.title', icon: 'ribbon-outline' },
      { path: '/ads', label: 'mon.ads.title', icon: 'megaphone-outline' },
      { path: '/bookmarks', label: 'creator.tile.bookmarks', icon: 'bookmark-outline' },
    ],
  },
  {
    title: 'ma.more.learnWork',
    entries: [
      { path: '/education', label: 'education.title', icon: 'school-outline', flag: 'education' },
      { path: '/school', label: 'school.title', icon: 'library-outline', flag: 'school', on: true },
      { path: '/health', label: 'health.title', icon: 'medkit-outline', flag: 'health', on: true },
      { path: '/freelance', label: 'freelance.title', icon: 'laptop-outline', flag: 'freelance' },
      { path: '/jobs', label: 'jobs.title', icon: 'briefcase-outline', flag: 'jobs' },
      { path: '/work', label: 'work.title', icon: 'clipboard-outline' },
    ],
  },
  {
    title: 'ma.more.tools',
    entries: [
      { path: '/ai', label: 'ai.tile', icon: 'sparkles', accent: true },
      { path: '/miniapps', label: 'miniapps.title', icon: 'apps-outline' },
      { path: '/announcements', label: 'ops2.annUser.title', icon: 'megaphone-outline' },
      { path: '/my-sanctions', label: 'ops2.mine.title', icon: 'shield-half-outline' },
      { path: '/help', label: 'ma.help.title', icon: 'help-circle-outline' },
    ],
  },
];

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
  const visible = (e: Entry) => {
    if (!e.flag) return true;
    const v = flags.data?.flags[e.flag];
    return e.on ? v === true : v !== false;
  };

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
              <Skeleton width={60} height={60} rounded={radius.lg} />
            </View>
          ))}
        </View>
      ) : flags.isError ? (
        <ErrorState error={flags.error} onRetry={() => flags.refetch()} />
      ) : (
        <View>
          {SECTIONS.map((s, si) => {
            const entries = s.entries.filter(visible);
            const extra = s.title === 'ma.more.tools' && hasAdminAccess(me?.roles);
            if (entries.length === 0 && !extra) return null;
            return (
              <FadeInView key={s.title} index={si} style={{ marginBottom: spacing.lg }}>
                <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.sm }}>
                  {t(s.title)}
                </Text>
                <View style={styles.grid}>
                  {entries.map((e) => (
                    <View key={e.path} style={styles.cell}>
                      <ServiceTile icon={e.icon} label={t(e.label)} tint={e.accent ? brandAccent : undefined} onPress={() => router.push(e.path as never)} />
                    </View>
                  ))}
                  {extra ? (
                    <View style={styles.cell}>
                      <ServiceTile icon="shield-checkmark-outline" label={t('adm.hub.title')} onPress={() => router.push('/admin')} />
                    </View>
                  ) : null}
                </View>
              </FadeInView>
            );
          })}
          <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.sm }}>
            {t('ma.more.soon')}
          </Text>
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
  soonBox: { width: 60, height: 60, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
