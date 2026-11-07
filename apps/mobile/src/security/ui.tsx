import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { copyText } from './optional';

export function Card({ children, tone }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tone === 'warn' ? colors.dangerSoft : tone === 'info' ? colors.primarySoft : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.check}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={26} color={checked ? colors.primary : colors.textMuted} />
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

/** Bouton « Copier » avec confirmation brève (« Copié ») ; message d'échec si le presse-papiers est inaccessible. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <Button
      variant="secondary"
      label={state === 'done' ? t('security.copied') : state === 'failed' ? t('security.copyFailed') : (label ?? t('security.copy'))}
      onPress={async () => {
        setState((await copyText(text)) ? 'done' : 'failed');
        setTimeout(() => setState('idle'), 2000);
      }}
    />
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  check: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
