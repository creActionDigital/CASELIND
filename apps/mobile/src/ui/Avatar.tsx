import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/use-theme';
import { AuthImage } from './AuthImage';
import { Text } from './Text';

interface Props {
  name: string;
  size?: number;
  /** Photo de profil (`avatarUrl` de l'API) ; sans elle, les initiales. */
  contentUrl?: string | null;
}

/**
 * Avatar à initiales. Le contenu média exige l'en-tête Authorization (voir API_CONTRACTS, lot 2b) :
 * la photo s'affiche via AuthImage ; les initiales servent de repli.
 */
export function Avatar({ name, size = 40, contentUrl }: Props) {
  const { colors } = useTheme();
  if (contentUrl) return <AuthImage contentUrl={contentUrl} label={name} style={{ width: size, height: size, borderRadius: size / 2 }} />;
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
