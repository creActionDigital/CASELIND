import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { brandGradient } from '../theme/tokens';

/**
 * Symbole CASELIND : un « C » ouvert (le cercle des services connectés) et un point dans son ouverture
 * (un lieu, un nœud du réseau), sur un carré arrondi en dégradé de marque. Création originale.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="CASELIND">
      <Defs>
        <LinearGradient id="caselind-mark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={brandGradient[0]} />
          <Stop offset="1" stopColor={brandGradient[1]} />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="18" fill="url(#caselind-mark)" />
      <Path d="M42.6 21.4 A15 15 0 1 0 42.6 42.6" fill="none" stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" />
      <Circle cx="47.5" cy="32" r="3.6" fill="#FFFFFF" />
    </Svg>
  );
}
