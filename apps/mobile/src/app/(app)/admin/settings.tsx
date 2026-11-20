import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Denied, adminErrorMessage, useHasRole } from '../../../admin/kit';
import { fetchSettings, o2k, putSetting } from '../../../admin/ops2-api';
import { parseSettingValue, scopeOf, SETTING_KEYS, type SettingKeyName } from '../../../admin/ops2-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Paramètres par pays et ville : liste blanche de clés, valeur validée par le serveur ; `commission.defaultBps` et `limits.*` en double validation. */
export default function Settings() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const allowed = useHasRole(['admin']);
  const [key, setKey] = useState<SettingKeyName>('support.contact');
  const [scope, setScope] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stored = useQuery({ queryKey: o2k.list('settings'), queryFn: fetchSettings, enabled: allowed });

  const parsed = parseSettingValue(key, value);
  const sc = scopeOf(scope);
  const ready = parsed !== undefined && sc !== null && reason.trim().length >= 3;
  const save = useMutation({
    mutationFn: () => putSetting({ key, scope: sc!, value: parsed, reason: reason.trim() }),
    onSuccess: (data) => {
      setNotice('approvalId' in data ? t('ops2.pending') : t('ops2.settings.saved'));
      setError(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: o2k.all });
    },
    onError: (e) => { setNotice(null); setError(adminErrorMessage(e, t, locale)); },
  });
  if (!allowed) return <Denied />;
  const submit = () => {
    if (!ready) { setError(t('ops2.settings.invalid')); return; }
    alertConfirm(t('adm.confirmTitle'), t('ops2.settings.confirm', { key, scope: sc! }), [
      { text: t('adm.cancel'), style: 'cancel' },
      { text: t('ops2.settings.save'), onPress: () => save.mutate() },
    ]);
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: t('ops2.settings.title') }} />
      <Chips<SettingKeyName> value={key} onChange={setKey} options={SETTING_KEYS.map((k) => ({ value: k, label: k }))} />
      <Text variant="small" muted>{t(`ops2.settings.hint.${key}` as MessageKey)}</Text>
      <TextField label={t('ops2.settings.scope')} value={scope} onChangeText={setScope} autoCapitalize="none" maxLength={70} />
      <TextField label={t('ops2.settings.value')} value={value} onChangeText={setValue} multiline autoCapitalize="none" maxLength={1000} />
      <TextField label={t('ops2.settings.reason')} value={reason} onChangeText={setReason} maxLength={300} />
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={t('ops2.settings.save')} loading={save.isPending} onPress={submit} />
      <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>{t('ops2.settings.current')}</Text>
      {stored.isError ? <ErrorState error={stored.error} onRetry={() => stored.refetch()} /> : null}
      {stored.data && stored.data.items.length === 0 ? <Text muted>{t('ops2.settings.none')}</Text> : null}
      {stored.data?.items.map((s) => (
        <Card key={`${s.key}|${s.scope}`} style={styles.card}>
          <Text variant="bodyStrong">{s.key} · {s.scope}</Text>
          <Text variant="small" muted>{JSON.stringify(s.value)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.xs, marginBottom: spacing.sm } });
