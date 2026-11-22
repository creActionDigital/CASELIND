import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { fonts, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';
import { PressableScale } from './PressableScale';

interface Props {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  /** Teinte : bleu du logo (défaut) ou orange du logo. */
  tone?: 'primary' | 'action';
  /** Ancien nom : toute valeur passe en orange (maps.tsx, hors périmètre). */
  tint?: string;
  /** Pastille de nombre (ex. non lus). */
  badge?: number;
}

/** Tuile de service unique : pastille ronde douce + icône, libellé Mulish medium 12 px sur 2 lignes. À poser via ServiceGrid. */
export function ServiceTile({ icon, label, onPress, tone = 'primary', badge, tint }: Props) {
  const { colors } = useTheme();
  const action = tone === 'action' || !!tint;
  return (
    <PressableScale onPress={onPress} accessibilityLabel={badge ? `${label}, ${badge}` : label} style={styles.wrap}>
      <View style={[styles.disc, { backgroundColor: action ? colors.actionSoft : colors.primarySoft }]}>
        <Ionicons name={icon} size={24} color={action ? colors.action : colors.primary} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Text variant="caption" color={colors.onAccent} style={{ fontSize: 10, lineHeight: 14 }}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs + 2, minHeight: 44, width: '100%', paddingHorizontal: 2 },
  disc: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center', fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
});
