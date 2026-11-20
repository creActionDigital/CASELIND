import { Image } from 'react-native';
import { LogoMark } from './Logo';

const HORIZONTAL_RATIO = 3378 / 562;
const VERTICAL_RATIO = 2762 / 1846;

/**
 * Logo officiel CASELIND (images fournies par le propriétaire) : horizontal par défaut, `vertical` pour l'accueil et
 * la connexion, `markOnly` pour les espaces étroits. `size` = hauteur du texte de référence.
 */
export function Wordmark({ size = 20, markOnly = false, vertical = false }: { size?: number; markOnly?: boolean; vertical?: boolean }) {
  if (markOnly) return <LogoMark size={size * 1.5} />;
  const height = vertical ? size * 4 : size * 1.6;
  return (
    <Image
      source={vertical ? require('../../assets/images/logo-vertical.png') : require('../../assets/images/logo-horizontal.png')}
      style={{ height, width: height * (vertical ? VERTICAL_RATIO : HORIZONTAL_RATIO), alignSelf: vertical ? 'center' : 'flex-start' }}
      resizeMode="contain"
      accessible
      accessibilityRole="header"
      accessibilityLabel="CASELIND"
    />
  );
}
