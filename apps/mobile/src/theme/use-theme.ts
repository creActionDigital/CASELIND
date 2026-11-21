import { useColorScheme } from 'react-native';
import { usePrefs } from '../prefs/store';
import { resolveDark } from '../prefs/logic';
import { dark, light, type Palette } from './tokens';

/** Palette selon le choix Apparence (clair / sombre / système, persistant). */
export function useTheme(): { colors: Palette; isDark: boolean } {
  const scheme = useColorScheme();
  const { theme } = usePrefs();
  const isDark = resolveDark(theme, scheme === 'dark');
  return { colors: isDark ? dark : light, isDark };
}
