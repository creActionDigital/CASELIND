import { View } from 'react-native';
import { fonts } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { LogoMark } from './Logo';
import { Text } from './Text';

/** Logo complet : symbole + « CASELIND » en Poppins. `markOnly` pour les espaces étroits. */
export function Wordmark({ size = 20, markOnly = false }: { size?: number; markOnly?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="CASELIND"
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.4 }}
    >
      <LogoMark size={size * 1.5} />
      {markOnly ? null : (
        <Text
          color={colors.text}
          style={{ fontFamily: fonts.bold, fontSize: size, lineHeight: size * 1.3, letterSpacing: size * 0.06 }}
        >
          CASELIND
        </Text>
      )}
    </View>
  );
}
