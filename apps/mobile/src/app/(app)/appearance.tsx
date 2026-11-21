import { Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import type { ThemeMode } from '../../prefs/logic';
import { setPrefs, usePrefs } from '../../prefs/store';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Screen, Text } from '../../ui';

const MODES: { value: ThemeMode; label: MessageKey }[] = [
  { value: 'system', label: 'ma.appearance.system' },
  { value: 'light', label: 'ma.appearance.light' },
  { value: 'dark', label: 'ma.appearance.dark' },
];

/** Apparence : clair, sombre ou système ; le choix est mémorisé sur l'appareil. */
export default function Appearance() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { theme } = usePrefs();
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.appearance.title') }} />
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('ma.appearance.intro')}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {MODES.map((m) => {
          const selected = theme === m.value;
          return (
            <Pressable key={m.value} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={t(m.label)} onPress={() => setPrefs({ theme: m.value })} style={styles.row}>
              <Text style={{ flex: 1 }}>{t(m.label)}</Text>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>{selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}</View>
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
