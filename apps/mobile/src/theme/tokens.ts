/**
 * Identité visuelle CASELIND : langage inspiré des principes Apple (HIG) — base neutre, couleurs du logo officiel
 * (bleu #0F70B7 principal, orange #ED6B1B secondaire), typographie Mulish (police de la maquette du propriétaire), surfaces calmes et séparateurs fins.
 * Le rouge est réservé aux pastilles et aux alertes. Contrastes vérifiés AA (texte ≥ 4.5:1, interface ≥ 3:1).
 */
export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string; // ≥ 4.5:1 sur background et surface
  primary: string;
  onPrimary: string;
  primarySoft: string;
  /** Actions principales (boutons, barres d'action, boutons flottants) : orange du logo ; le bleu reste à la navigation et à l'information. */
  action: string;
  onAction: string;
  actionSoft: string;
  accent: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  success: string;
  overlay: string;
  tabBar: string;
}

export const light: Palette = {
  background: '#F2F2F7', // fond groupé
  surface: '#FFFFFF',
  surfaceAlt: '#E9E9EF',
  border: '#D1D1D6',
  text: '#1D1D1F', // 15.6:1 sur background
  textMuted: '#636366', // 5.4:1 sur background, 5.9:1 sur surface
  primary: '#0F70B7', // bleu du logo : 5.2:1 avec blanc, 4.7:1 sur background
  onPrimary: '#FFFFFF',
  primarySoft: '#E3EFF8',
  action: '#ED6B1B', // orange du logo ; libellé blanc en gros texte gras (≥ 19 px, contraste 3,1:1 suffisant)
  onAction: '#FFFFFF',
  actionSoft: '#FDEBDD',
  accent: '#D70015', // pastilles de notification : 5.9:1 avec blanc
  onAccent: '#FFFFFF',
  danger: '#D70015',
  onDanger: '#FFFFFF',
  dangerSoft: '#FDE7E9',
  success: '#1B7F3B', // 5.2:1 avec blanc
  overlay: 'rgba(0,0,0,0.4)',
  tabBar: 'rgba(249,249,251,0.94)',
};

export const dark: Palette = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceAlt: '#2C2C2E',
  border: '#38383A',
  text: '#F5F5F7', // 19:1
  textMuted: '#A1A1A6', // 8:1 sur background, 6.6:1 sur surface
  primary: '#4DA3E8', // bleu du logo éclairci : 7.7:1 sur background
  onPrimary: '#04121F', // 7.4:1 sur primary
  primarySoft: '#0E2A40',
  action: '#ED6B1B',
  onAction: '#FFFFFF',
  actionSoft: '#3A2010',
  accent: '#FF453A',
  onAccent: '#1A0000', // 6.0:1
  danger: '#FF6961', // 7.4:1 sur background
  onDanger: '#1A0000',
  dangerSoft: '#3A1513',
  success: '#30D158',
  overlay: 'rgba(0,0,0,0.6)',
  tabBar: 'rgba(22,22,24,0.94)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 14, lg: 22, xl: 28, xxl: 32, pill: 999 } as const;

/**
 * Couleur de marque UNIE (logo, bouton central, actions principales) : le propriétaire ne veut pas de
 * dégradés. Gardé sous forme de paire pour les composants `LinearGradient` existants, qui rendent ainsi
 * un aplat. Texte blanc dessus : 5,2:1 (AA). Ne pas réintroduire de dégradé décoratif.
 */
export const brandColor = '#0F70B7';
export const brandGradient = [brandColor, brandColor] as const;
/** Orange du logo, couleur secondaire de marque (assistant IA, mises en avant) : icônes ou gros texte seulement (3,1:1 avec blanc). */
export const brandAccent = '#ED6B1B';

/** Surfaces sombres « vitrées » posées sur une photo ou une vidéo (live, visionneuses). */
export const glass = { dark: 'rgba(17,17,24,0.55)', light: 'rgba(255,255,255,0.18)', border: 'rgba(255,255,255,0.22)' } as const;

/** Police de marque : Mulish, celle de la maquette du propriétaire (chargée au démarrage) ; un poids = une famille sous React Native. */
export const fonts = {
  regular: 'Mulish_400Regular',
  medium: 'Mulish_500Medium',
  semibold: 'Mulish_600SemiBold',
  bold: 'Mulish_700Bold',
  extrabold: 'Mulish_800ExtraBold',
} as const;

/** Texte et icônes posés sur un média ou sur l'overlay (toujours clair, quel que soit le thème). */
export const onMedia = '#FFFFFF';

/** Marge basse des écrans d'onglets : la barre flottante (64 pt + marge + zone sûre) recouvre le contenu. */
export const TAB_BAR_SPACE = 112;

/** Taille minimale d'une cible tactile (points). */
export const TOUCH = 44;

/** Durées d'animation : micro-interaction, transition standard. Les sorties sont plus rapides que les entrées. */
export const motion = { fast: 150, base: 250 } as const;

export const typography = {
  // Mulish (chargée au démarrage) ; le système prend le relais tant qu'elle n'est pas prête.
  family: fonts.regular as string | undefined,
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 33, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
};

export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  /** Barre d'onglets flottante et bouton central. */
  float: {
    shadowColor: '#1E1B4B',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;
