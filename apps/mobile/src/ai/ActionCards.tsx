import type { AiAction, AiActionResult } from '@caselind/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { confirmAiAction, dismissAiAction } from './assist-api';
import { actionErrorKey, consentNeeded, isPending, resultLines } from './assist-logic';

type Decided = { kind: 'done'; result: AiActionResult | null } | { kind: 'dismissed' };

/**
 * Actions proposées par l'assistant : jamais exécutées sans le bouton Confirmer ; Ignorer les écarte.
 * Une confirmation lance l'action côté serveur avec les droits de l'utilisateur.
 */
export function ActionCards({ actions, onNeedConsent }: { actions: readonly AiAction[]; onNeedConsent: (retry: () => void) => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [decided, setDecided] = useState<Map<string, Decided>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  const mark = (id: string, d: Decided) => setDecided((m) => new Map(m).set(id, d));
  const fail = (id: string, err: unknown, retry: () => void) => {
    if (consentNeeded(err) === 'ai_processing') return onNeedConsent(retry);
    const key = actionErrorKey(err);
    setErrors((m) => new Map(m).set(id, key ? t(key) : errorMessage(err, t, locale)));
  };

  const confirm = useMutation({
    mutationFn: (a: AiAction) => confirmAiAction(a.id),
    onSuccess: (out) => {
      mark(out.action.id, { kind: 'done', result: out.result });
      if (out.result?.kind === 'open_screen') router.push(out.result.path as never);
    },
    onError: (err, a) => fail(a.id, err, () => confirm.mutate(a)),
  });
  const dismiss = useMutation({
    mutationFn: (a: AiAction) => dismissAiAction(a.id),
    onSuccess: (a) => mark(a.id, { kind: 'dismissed' }),
    onError: (err, a) => fail(a.id, err, () => dismiss.mutate(a)),
  });

  const visible = actions.filter((a) => decided.has(a.id) || isPending(a));
  if (visible.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text variant="small" muted>
        {t('aiact.notice')}
      </Text>
      {visible.map((a) => {
        const d = decided.get(a.id);
        const busy = (confirm.isPending && confirm.variables?.id === a.id) || (dismiss.isPending && dismiss.variables?.id === a.id);
        const lines = d?.kind === 'done' && d.result ? resultLines(d.result) : [];
        return (
          <View key={a.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible={false}>
            <Text variant="bodyStrong">{a.label}</Text>
            {d?.kind === 'dismissed' ? (
              <Text variant="small" muted>
                {t('aiact.dismissed')}
              </Text>
            ) : d?.kind === 'done' ? (
              <View style={{ gap: spacing.xs }}>
                <Text variant="small" color={colors.primary}>
                  {t('aiact.done')}
                </Text>
                {d.result && d.result.kind !== 'open_screen' && lines.length === 0 ? <Text variant="small" muted>{t('aiact.empty')}</Text> : null}
                {lines.map((l, i) => (
                  <Text key={i} variant="small" selectable>
                    {l}
                  </Text>
                ))}
              </View>
            ) : (
              <>
                <Text variant="caption" muted>
                  {t('aiact.expires')}
                </Text>
                <View style={styles.buttons}>
                  <View style={styles.flex}>
                    <Button label={t('aiact.confirm')} onPress={() => confirm.mutate(a)} loading={busy && confirm.isPending} disabled={busy} />
                  </View>
                  <View style={styles.flex}>
                    <Button variant="secondary" label={t('aiact.dismiss')} onPress={() => dismiss.mutate(a)} disabled={busy} />
                  </View>
                </View>
              </>
            )}
            {errors.get(a.id) ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {errors.get(a.id)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingTop: spacing.sm },
  card: { gap: spacing.xs, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
