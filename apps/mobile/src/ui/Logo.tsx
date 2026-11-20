import { Image } from 'react-native';

/** Symbole CASELIND (logo officiel, assets/images/logo-mark.png ; régénéré par scripts/brand-assets.cjs). */
export const MARK_RATIO = 1588 / 1159;

/** Symbole seul, `size` = largeur. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/logo-mark.png')}
      style={{ width: size, height: size / MARK_RATIO }}
      resizeMode="contain"
      accessibilityLabel="CASELIND"
    />
  );
}
