import { StyleSheet, Text as RNText, type TextProps } from 'react-native';
import { fonts, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'caption';

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  color?: string;
}

/** Texte thémé ; la taille respecte le réglage de police du système (accessibilité). */
export function Text({ variant = 'body', muted, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  // Mulish = un fichier par graisse : un fontWeight inline doit choisir la bonne famille (sinon faux gras sur le web/Android).
  const w = StyleSheet.flatten(style)?.fontWeight;
  const family = w === '800' || w === '900' ? fonts.extrabold : w === '700' || w === 'bold' ? fonts.bold : w === '600' ? fonts.semibold : w === '500' ? fonts.medium : w === '400' || w === 'normal' ? fonts.regular : undefined;
  return <RNText {...rest} style={[typography[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style, family ? { fontFamily: family } : null]} />;
}
