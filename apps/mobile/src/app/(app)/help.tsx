import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Screen, Text } from '../../ui';

type Icon = ComponentProps<typeof Ionicons>['name'];
const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: 'ma.help.q1', a: 'ma.help.a1' },
  { q: 'ma.help.q2', a: 'ma.help.a2' },
  { q: 'ma.help.q3', a: 'ma.help.a3' },
  { q: 'ma.help.q4', a: 'ma.help.a4' },
  { q: 'ma.help.q5', a: 'ma.help.a5' },
  { q: 'ma.help.q6', a: 'ma.help.a6' },
];

/** Centre d'aide : questions fréquentes, puis accès au support, au signalement d'un problème et à « À propos ». */
export default function Help() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const link = (icon: Icon, label: MessageKey, go: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={t(label)} onPress={go} style={[styles.link, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={{ flex: 1 }}>{t(label)}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.help.title') }} />
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('ma.help.intro')}
      </Text>
      <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.sm }}>
        {t('ma.help.faq')}
      </Text>
      {FAQ.map((f, i) => {
        const expanded = open === i;
        return (
          <View key={f.q} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : i)} style={styles.q}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t(f.q)}
              </Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {expanded ? (
              <Text muted style={{ paddingBottom: spacing.md }}>
                {t(f.a)}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text variant="heading" accessibilityRole="header" style={{ marginVertical: spacing.md }}>
        {t('ma.help.more')}
      </Text>
      {link('chatbubbles-outline', 'ma.support.title', () => router.push('/support'))}
      {link('bug-outline', 'ma.support.problemTitle', () => router.push({ pathname: '/support', params: { mode: 'problem' } }))}
      {link('flag-outline', 'report.mine.title', () => router.push('/my-reports'))}
      {link('information-circle-outline', 'ma.about.title', () => router.push('/about'))}
      <Button variant="ghost" label={t('ma.help.privacy')} onPress={() => router.push('/privacy')} style={{ marginTop: spacing.md }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  q: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  link: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.sm },
});
