import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { getPushPermission, PUSH_SUPPORTED, requestPushAndRegister } from './push';

let dismissed = false; // pour la durée de la session de l'application

/**
 * Explication à l'écran AVANT la demande de permission système (jamais au démarrage).
 * N'apparaît que sur mobile, tant que la permission n'a pas été décidée.
 */
export function PushCard() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [state, setState] = useState<'hidden' | 'ask' | 'busy' | 'denied' | 'unavailable'>('hidden');

  useEffect(() => {
    if (!PUSH_SUPPORTED || dismissed) return;
    getPushPermission().then(
      (p) => p === 'undetermined' && setState('ask'),
      () => undefined,
    );
  }, []);

  if (state === 'hidden') return null;

  async function enable() {
    setState('busy');
    try {
      const r = await requestPushAndRegister();
      if (r === 'registered') setState('hidden');
      else setState(r);
    } catch {
      setState('unavailable');
    }
  }
  function dismiss() {
    dismissed = true;
    setState('hidden');
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('push.title')}
      </Text>
      <Text variant="small">{state === 'denied' ? t('push.denied') : state === 'unavailable' ? t('push.unavailable') : t('push.body')}</Text>
      <Text variant="small" muted>
        {t('push.privacy')}
      </Text>
      <View style={styles.row}>
        {state === 'ask' || state === 'busy' ? (
          <Button label={t('push.enable')} onPress={enable} loading={state === 'busy'} style={styles.flex} />
        ) : null}
        <Button label={t('push.later')} variant="secondary" onPress={dismiss} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1, paddingHorizontal: spacing.sm },
});
