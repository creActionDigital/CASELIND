import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Text } from '../ui';
import { SheetModal } from './SheetModal';

type Icon = ComponentProps<typeof Ionicons>['name'];

const ACTIONS: { key: MessageKey; icon: Icon }[] = [
  { key: 'scan.action', icon: 'qr-code-outline' },
  { key: 'publish.post', icon: 'create-outline' },
  { key: 'publish.story', icon: 'aperture-outline' },
  { key: 'publish.video', icon: 'videocam-outline' },
  { key: 'publish.product', icon: 'pricetag-outline' },
  { key: 'publish.live', icon: 'radio-outline' },
  { key: 'publish.listing', icon: 'megaphone-outline' },
  { key: 'mb.create.album', icon: 'images-outline' },
  { key: 'mb.create.event', icon: 'calendar-outline' },
  { key: 'mb.create.poll', icon: 'stats-chart-outline' },
  { key: 'mb.create.location', icon: 'location-outline' },
  { key: 'mb.create.service', icon: 'construct-outline' },
  { key: 'mb.create.job', icon: 'briefcase-outline' },
];

/** Actions actives : touche -> route (le live est géré par le hub via onLive). Les autres restent « bientôt ». */
const ROUTES: Partial<Record<MessageKey, string>> = {
  'scan.action': '/scan',
  'publish.story': '/story/new',
  'publish.post': '/compose?mode=post',
  'publish.video': '/compose?mode=video',
  'publish.product': '/seller',
  'publish.listing': '/listings/new',
  'mb.create.album': '/compose?mode=album',
  'mb.create.event': '/compose?mode=event',
  'mb.create.poll': '/compose?mode=poll',
  'mb.create.location': '/compose?mode=location',
  'mb.create.service': '/provider/me',
  'mb.create.job': '/seller',
};

/** Feuille « + Publier » du hub (pages Live, Vidéos, Posts, Produits) : chaque type de publication, au plus près des contenus. */
export function PublishSheet({ visible, onClose, onLive }: { visible: boolean; onClose: () => void; onLive?: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <SheetModal visible={visible} onClose={onClose}>
      <Text variant="title" accessibilityRole="header">
        {t('publish.title')}
      </Text>
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('publish.subtitle')}
      </Text>
      <View style={styles.grid}>
        {ACTIONS.map((a) =>
          ROUTES[a.key] || (a.key === 'publish.live' && onLive) ? (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={t(a.key)}
              onPress={() => {
                onClose();
                if (a.key === 'publish.live') onLive?.();
                else router.push(ROUTES[a.key]! as never);
              }}
              style={[styles.tile, { backgroundColor: colors.primarySoft, opacity: 1 }]}
            >
              <Ionicons name={a.icon} size={26} color={colors.primary} />
              <Text variant="small">{t(a.key)}</Text>
            </Pressable>
          ) : (
          <View
            key={a.key}
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={`${t(a.key)}, ${t('common.soon')}`}
            style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}
          >
            <Ionicons name={a.icon} size={26} color={colors.textMuted} />
            <Text variant="small">{t(a.key)}</Text>
            <Badge tone="neutral" label={t('common.soon')} />
          </View>
          ),
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    width: '30%',
    flexGrow: 1,
    minHeight: 96,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    opacity: 0.85,
  },
});
