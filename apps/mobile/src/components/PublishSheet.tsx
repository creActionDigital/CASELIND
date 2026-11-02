import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Text } from '../ui';
import { SheetModal } from './SheetModal';

type Icon = ComponentProps<typeof Ionicons>['name'];

const ACTIONS: { key: MessageKey; icon: Icon }[] = [
  { key: 'publish.post', icon: 'create-outline' },
  { key: 'publish.story', icon: 'aperture-outline' },
  { key: 'publish.video', icon: 'videocam-outline' },
  { key: 'publish.product', icon: 'pricetag-outline' },
  { key: 'publish.live', icon: 'radio-outline' },
  { key: 'publish.listing', icon: 'megaphone-outline' },
];

/** Feuille « + Publier » : toutes les actions sont annoncées « bientôt » (backend social non livré). */
export function PublishSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <SheetModal visible={visible} onClose={onClose}>
      <Text variant="title" accessibilityRole="header">
        {t('publish.title')}
      </Text>
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('publish.subtitle')}
      </Text>
      <View style={styles.grid}>
        {ACTIONS.map((a) => (
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
        ))}
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
