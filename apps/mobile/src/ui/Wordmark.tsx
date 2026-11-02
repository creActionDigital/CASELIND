import { View } from 'react-native';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

/** Mot-symbole CASELIND : texte stylé (pas d'image), point indigo en signature. */
export function Wordmark({ size = 20 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="CASELIND" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text
        color={colors.text}
        style={{ fontSize: size, lineHeight: size * 1.2, fontWeight: '800', letterSpacing: size * 0.08 }}
      >
        CASELIND
      </Text>
      <View
        style={{
          width: size * 0.26,
          height: size * 0.26,
          borderRadius: size,
          backgroundColor: colors.primary,
          marginLeft: 2,
          marginBottom: size * 0.2,
        }}
      />
    </View>
  );
}
