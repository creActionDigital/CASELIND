import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

/** Palette suivant le thème système. */
export function useTheme(): { colors: Palette; isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? dark : light, isDark };
}
