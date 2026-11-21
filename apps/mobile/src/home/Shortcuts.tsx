import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { brandAccent, spacing } from '../theme/tokens';
import { FadeInView, PromoBanner, ServiceTile, type Promo } from '../ui/premium';

type Icon = ComponentProps<typeof Ionicons>['name'];
const TILES: { icon: Icon; label: MessageKey; path: string; accent?: boolean }[] = [
  { icon: 'scan-outline', label: 'ma.home.scan', path: '/scan' },
  { icon: 'paper-plane-outline', label: 'ma.home.send', path: '/wallet/send' },
  { icon: 'car-outline', label: 'ma.home.ride', path: '/rides' },
  { icon: 'cube-outline', label: 'ma.home.delivery', path: '/courier' },
  { icon: 'bag-handle-outline', label: 'ma.home.shop', path: '/shop' },
  { icon: 'apps-outline', label: 'ma.home.miniapps', path: '/miniapps' },
  { icon: 'sparkles', label: 'ma.home.ai', path: '/ai', accent: true },
  { icon: 'grid-outline', label: 'ma.home.more', path: '/more' },
];

/** Accueil : raccourcis (la recherche est dans l'en-tête) services en grille (4 colonnes) et bannières promo. */
export function HomeShortcuts() {
  const { t } = useI18n();
  const router = useRouter();
  const go = (p: string) => router.push(p as never);
  const promos: Promo[] = [
    { id: 'shop', title: t('ma.promo.shop.title'), subtitle: t('ma.promo.shop.sub'), icon: 'storefront-outline', onPress: () => go('/seller/new') },
    { id: 'discover', title: t('ma.promo.discover.title'), subtitle: t('ma.promo.discover.sub'), icon: 'people-outline', color: brandAccent, onPress: () => go('/discover') },
    { id: 'ai', title: t('ma.promo.ai.title'), subtitle: t('ma.promo.ai.sub'), icon: 'sparkles', onPress: () => go('/ai') },
  ];
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {TILES.map((x, i) => (
          <FadeInView key={x.path} index={i} style={styles.cell}>
            <ServiceTile icon={x.icon} label={t(x.label)} tint={x.accent ? brandAccent : undefined} onPress={() => go(x.path)} />
          </FadeInView>
        ))}
      </View>
      <PromoBanner items={promos} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  cell: { width: '25%' },
});
