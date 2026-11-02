/**
 * Identité visuelle CASELIND — originale, sans référence à une autre marque.
 * Idée : « lac au crépuscule » — indigo profond (confiance, finance) + soleil ambre (énergie, action centrale)
 * + corail pour les alertes. Contrastes vérifiés AA (texte ≥ 4.5:1, éléments d'interface ≥ 3:1).
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
  background: '#F6F5FB',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEAF6',
  border: '#CFCBE3',
  text: '#16142B', // 16:1 sur background
  textMuted: '#55527A', // 6.9:1
  primary: '#3730A3', // 9.4:1 avec blanc
  onPrimary: '#FFFFFF',
  primarySoft: '#E3E1F8',
  accent: '#F5A524',
  onAccent: '#1F1300', // 9.9:1
  danger: '#B42318', // 6.5:1 avec blanc
  onDanger: '#FFFFFF',
  dangerSoft: '#FDE8E6',
  success: '#0B6B4B',
  overlay: 'rgba(22,20,43,0.5)',
  tabBar: '#FFFFFF',
};

export const dark: Palette = {
  background: '#0F0E1C',
  surface: '#1A1930',
  surfaceAlt: '#262445',
  border: '#3D3A66',
  text: '#F1F0FB', // 15:1
  textMuted: '#B3B0D6', // 8:1
  primary: '#A5A0FF', // 7.4:1 sur background
  onPrimary: '#12104A', // 8:1 sur primary
  primarySoft: '#2B2870',
  accent: '#FFB840',
  onAccent: '#1F1300',
  danger: '#FF8A80', // 7.6:1
  onDanger: '#3A0905',
  dangerSoft: '#3D1614',
  success: '#5FD3A5',
  overlay: 'rgba(0,0,0,0.65)',
  tabBar: '#1A1930',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

/** Taille minimale d'une cible tactile (points). */
export const TOUCH = 44;

export const typography = {
  // Polices système (aucun téléchargement, bon rendu sur Android bas de gamme).
  family: undefined as string | undefined,
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
};

export const shadow = {
  card: {
    shadowColor: '#16142B',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#16142B',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;
