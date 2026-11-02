import { useRouter, type Href } from 'expo-router';
import { Pressable } from 'react-native';
import { TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

/** Lien textuel (cible tactile ≥ 44 pt). */
export function TextLink({ label, href, onPress }: { label: string; href?: Href; onPress?: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => (onPress ? onPress() : href ? router.push(href) : undefined)}
      style={{ minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}
    >
      <Text variant="bodyStrong" color={colors.primary}>
        {label}
      </Text>
    </Pressable>
  );
}
