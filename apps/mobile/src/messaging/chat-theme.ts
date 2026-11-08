import { brandColor, type Palette } from '../theme/tokens';

/** Couleurs de la messagerie : bleu nuit en thème sombre (maquette), thème clair standard sinon. */
export interface ChatColors {
  bg: string;
  card: string;
  field: string;
  mineBubble: string;
  onMine: string;
  theirBubble: string;
  onTheirs: string;
  accent: string;
  tick: string;
}

export function chatColors(colors: Palette, isDark: boolean): ChatColors {
  return isDark
    ? {
        bg: '#050B18',
        card: '#0F1B2D',
        field: '#111C2E',
        mineBubble: '#1F5F94',
        onMine: '#FFFFFF',
        theirBubble: '#151F30',
        onTheirs: '#F5F5F7',
        accent: brandColor,
        tick: '#8FD0FF',
      }
    : {
        bg: colors.background,
        card: colors.surface,
        field: colors.surface,
        mineBubble: brandColor,
        onMine: '#FFFFFF',
        theirBubble: colors.surface,
        onTheirs: colors.text,
        accent: brandColor,
        tick: '#C7D2FE',
      };
}
