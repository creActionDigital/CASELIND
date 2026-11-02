import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

interface Props {
  name: string;
  size?: number;
}

/**
 * Avatar à initiales. Le contenu média exige l'en-tête Authorization (voir API_CONTRACTS, lot 2b) :
 * l'affichage de la photo viendra avec le lot média ; les initiales servent de repli.
 */
export function Avatar({ name, size = 40 }: Props) {
  const { colors } = useTheme();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft }]}
    >
      <Text variant="bodyStrong" color={colors.primary} style={{ fontSize: size * 0.4, lineHeight: size * 0.5 }}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center' } });
