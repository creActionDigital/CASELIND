import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from './Text';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Champ mot de passe : ajoute le bouton Afficher/Masquer. */
  secure?: boolean;
}

export function TextField({ label, error, hint, secure, ...input }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      <View
        style={[
          styles.box,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : focused ? colors.primary : colors.border },
          focused && styles.focused,
        ]}
      >
        <TextInput
          {...input}
          accessibilityLabel={label}
          accessibilityHint={hint}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, typography.body, { color: colors.text }]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('common.hide') : t('common.show')}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={4}
            style={styles.toggle}
          >
            <Text variant="small" color={colors.primary}>
              {revealed ? t('common.hide') : t('common.show')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.msg}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" muted style={styles.msg}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.xs, fontWeight: '600' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    minHeight: TOUCH + 4,
    paddingHorizontal: spacing.md,
  },
  focused: { borderWidth: 2 },
  input: { flex: 1, minHeight: TOUCH, paddingVertical: spacing.sm },
  toggle: { minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', alignItems: 'center', paddingLeft: spacing.sm },
  msg: { marginTop: spacing.xs },
});
