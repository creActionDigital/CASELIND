import { Pressable, StyleSheet, View } from 'react-native';
import { api, useAuth } from '../../auth/auth-context';
import { meSchema } from '@caselind/contracts';
import { useI18n, type Locale } from '../../i18n';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Screen, Text } from '../../ui';

const LOCALES: Locale[] = ['fr', 'en'];

/** Langue : change l'interface immédiatement et enregistre la préférence via PATCH /v1/me (sans bloquer l'écran). */
export default function Language() {
  const { colors } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { setMe } = useAuth();

  function choose(next: Locale) {
    setLocale(next);
    api
      .request('/me', { method: 'PATCH', body: { locale: next }, schema: meSchema })
      .then(setMe)
      .catch(() => undefined);
  }

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {LOCALES.map((value) => {
          const selected = locale === value;
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => choose(value)} style={styles.row}>
              <Text style={{ flex: 1 }}>{t(value === 'fr' ? 'language.fr' : 'language.en')}</Text>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
                {selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  row: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
