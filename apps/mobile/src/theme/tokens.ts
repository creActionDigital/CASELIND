/**
 * Identité visuelle CASELIND : langage inspiré des principes Apple (HIG) — base neutre, une seule couleur
 * d'accent (l'indigo CASELIND), typographie système à l'échelle iOS, surfaces calmes et séparateurs fins.
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
  primary: '#4F46E5', // 6.3:1 avec blanc, 5.6:1 sur background
  onPrimary: '#FFFFFF',
  primarySoft: '#E8E7FC',
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
  primary: '#8E8AFF', // 7.3:1 sur background
  onPrimary: '#0B0A2E', // 7.5:1 sur primary
  primarySoft: '#25233F',
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
export const radius = { sm: 10, md: 14, lg: 22, xl: 28, pill: 999 } as const;

/** Taille minimale d'une cible tactile (points). */
export const TOUCH = 44;

/** Durées d'animation : micro-interaction, transition standard. Les sorties sont plus rapides que les entrées. */
export const motion = { fast: 150, base: 250 } as const;

export const typography = {
  // Polices système (SF Pro sur iOS, Roboto sur Android) : aucun téléchargement, rendu net partout.
  family: undefined as string | undefined,
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.2 },
  bodyStrong: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.2 },
  small: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: -0.1 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
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
} as const;
