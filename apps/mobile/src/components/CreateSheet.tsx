import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { brandAccent, brandColor, spacing, TOUCH } from '../theme/tokens';
import { Text } from '../ui';
import { AnimatedSheet, ServiceTile } from '../ui/premium';

type Icon = ComponentProps<typeof Ionicons>['name'];

/** Entrées du menu « + » : libellé, icône, route (le live se lance depuis l'onglet Live du hub). */
export const CREATE_ENTRIES: { key: MessageKey; icon: Icon; href: Href; accent?: boolean }[] = [
  { key: 'publish.post', icon: 'create-outline', href: '/compose?mode=post' },
  { key: 'publish.video', icon: 'videocam-outline', href: '/compose?mode=video' },
  { key: 'mb.create.album', icon: 'images-outline', href: '/compose?mode=album' },
  { key: 'create.story', icon: 'aperture-outline', href: '/story/new' },
  { key: 'mb.create.event', icon: 'calendar-outline', href: '/compose?mode=event' },
  { key: 'mb.create.poll', icon: 'stats-chart-outline', href: '/compose?mode=poll' },
  { key: 'mb.create.location', icon: 'location-outline', href: '/compose?mode=location' },
  { key: 'publish.live', icon: 'radio-outline', href: '/hub', accent: true },
  { key: 'create.sell', icon: 'pricetag-outline', href: '/seller', accent: true },
  { key: 'create.listing', icon: 'megaphone-outline', href: '/listings/new' },
  { key: 'mb.create.service', icon: 'construct-outline', href: '/provider/me' },
  { key: 'mb.create.job', icon: 'briefcase-outline', href: '/seller' },
];

/** Menu de création du bouton central « + » : feuille en bas avec tuiles, et accès à l'espace Vidéos/Live/Posts/Produits. */
export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  return (
    <AnimatedSheet visible={visible} onClose={onClose} title={t('create.title')}>
      <Text variant="title" accessibilityRole="header" style={{ marginBottom: spacing.lg }}>
        {t('create.title')}
      </Text>
      <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={styles.grid}>
        {CREATE_ENTRIES.map((e) => (
          <View key={e.key} style={styles.cell}>
            <ServiceTile icon={e.icon} label={t(e.key)} tint={e.accent ? brandAccent : undefined} onPress={() => go(e.href)} />
          </View>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="link" accessibilityLabel={t('create.explore')} onPress={() => go('/videos')} style={styles.link}>
        <Ionicons name="play-circle-outline" size={22} color={brandColor} />
        <Text variant="bodyStrong" color={brandColor}>
          {t('create.explore')}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.link}>
        <Text variant="bodyStrong" muted>
          {t('common.close')}
        </Text>
      </Pressable>
    </AnimatedSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  cell: { width: '25%' },
  link: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
});
