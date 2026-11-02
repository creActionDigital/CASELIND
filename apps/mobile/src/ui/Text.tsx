import { Text as RNText, type TextProps } from 'react-native';
import { typography } from '../theme/tokens';
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
  return <RNText {...rest} style={[typography[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]} />;
}
