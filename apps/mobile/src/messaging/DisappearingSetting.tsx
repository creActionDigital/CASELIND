import type { Conversation } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { patchDisappearing } from './extras-api';
import { canSetDisappearing, DISAPPEARING_OPTIONS } from './extras-logic';
import { qk } from './keys';
import { durationText } from './system-text';

/** Réglage des messages éphémères (Désactivé / 24 h / 7 jours / 90 jours), selon le rôle. */
export function DisappearingSetting({ conversation: c }: { conversation: Conversation }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const allowed = canSetDisappearing(c);
  const m = useMutation({
    mutationFn: (seconds: number | null) => patchDisappearing(c.id, seconds),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: qk.conversation(c.id) });
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
      void qc.invalidateQueries({ queryKey: qk.messages(c.id) });
    },
    onError: (err) => setError(errorMessage(err, t, locale)),
  });

  return (
    <View style={styles.wrap}>
      <Text variant="heading" accessibilityRole="header">
        {t('messagesX.disappearing.title')}
      </Text>
      <Text variant="small" muted>
        {allowed ? t('messagesX.disappearing.help') : t('messagesX.disappearing.denied')}
      </Text>
      <View accessibilityRole="radiogroup">
        {DISAPPEARING_OPTIONS.map((s) => {
          const on = (c.disappearingSeconds ?? null) === s;
          const label = s === null ? t('messagesX.disappearing.off') : durationText(s, t);
          return (
            <Pressable
              key={String(s)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !allowed || m.isPending }}
              accessibilityLabel={label}
              disabled={!allowed || m.isPending || on}
              onPress={() => m.mutate(s)}
              style={[styles.row, { borderBottomColor: colors.border, opacity: allowed ? 1 : 0.6 }]}
            >
              <Text style={styles.flex}>{label}</Text>
              {on ? <Ionicons name="checkmark" size={22} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.xl },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH, borderBottomWidth: StyleSheet.hairlineWidth },
});
