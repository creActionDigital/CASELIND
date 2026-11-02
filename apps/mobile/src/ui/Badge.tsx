import { StyleSheet, View } from 'react-native';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

interface Props {
  label: string;
  tone?: 'primary' | 'neutral' | 'accent';
}

/** Pastille de compteur ou d'état (« Bientôt »). Le contexte est donné par le parent via accessibilityLabel. */
export function Badge({ label, tone = 'primary' }: Props) {
  const { colors } = useTheme();
  const bg = tone === 'primary' ? colors.primary : tone === 'accent' ? colors.accent : colors.surfaceAlt;
  const fg = tone === 'primary' ? colors.onPrimary : tone === 'accent' ? colors.onAccent : colors.textMuted;
  return (
    <View style={[styles.base, { backgroundColor: bg }]} importantForAccessibility="no-hide-descendants">
      <Text variant="caption" color={fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: 18, height: 18, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
