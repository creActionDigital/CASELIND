import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { ApiRequestError } from '../../../../../lib/api';
import { alertConfirm } from '../../../../../lib/confirm';
import { errorMessage } from '../../../../../lib/errors';
import { createWebhook, deleteWebhook, fetchDeliveries, fetchWebhook, pKeys, rotateWebhookSecret, testWebhook } from '../../../../../miniapps/platform-api';
import { Card, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/** Webhook de l'application : événements signés (autorisation retirée, paiements, suppression de compte), test, journal. */
export default function DeveloperWebhook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const hook = useQuery({
    queryKey: pKeys.webhook(id),
    queryFn: () => fetchWebhook(id),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status === 404) && n < 2,
  });
  const deliveries = useQuery({ queryKey: pKeys.deliveries(id), queryFn: () => fetchDeliveries(id), enabled: hook.isSuccess });
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const missing = hook.error instanceof ApiRequestError && hook.error.status === 404;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: pKeys.webhook(id) });
    void qc.invalidateQueries({ queryKey: pKeys.deliveries(id) });
  };
  const create = useMutation({
    mutationFn: () => createWebhook(id, { url: url.trim() }),
    onSuccess: (r) => {
      setSecret(r.secret);
      refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: () => rotateWebhookSecret(id),
    onSuccess: (r) => {
      setSecret(r.secret);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteWebhook(id),
    onSuccess: () => {
      setSecret(null);
      refresh();
    },
  });
  const test = useMutation({
    mutationFn: () => testWebhook(id),
    onSuccess: (d) => {
      setTestResult(t(d.status === 'delivered' ? 'mp.dev.hook.testOk' : 'mp.dev.hook.testKo', { code: d.httpStatus ?? d.errorCode ?? '-' }));
      refresh();
    },
  });
  const askDelete = () =>
    alertConfirm(t('mp.dev.hook.deleteTitle'), t('mp.dev.hook.deleteBody'), [
      { text: t('miniapps.pay.cancel'), style: 'cancel' },
      { text: t('mp.dev.hook.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);

  if (hook.isPending) return <Loading />;
  if (hook.isError && !missing) return <ErrorState error={hook.error} onRetry={() => hook.refetch()} />;
  const failure = create.error ?? rotate.error ?? remove.error ?? test.error;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mp.dev.hook.title') }} />
      <View style={{ gap: spacing.md }}>
        <Text variant="small" muted>{t('mp.dev.hook.hint')}</Text>
        {secret ? (
          <Card>
            <Text variant="small" selectable style={{ fontWeight: '600' }}>{secret}</Text>
            <Text variant="caption" muted>{t('miniapps.dev.secret.once')}</Text>
            <Button variant="secondary" label={t('miniapps.dev.secret.done')} onPress={() => setSecret(null)} />
          </Card>
        ) : null}
        {missing || !hook.data ? (
          <Card>
            <TextField label={t('mp.dev.hook.url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Button label={t('mp.dev.hook.create')} loading={create.isPending} disabled={url.trim().length < 12} onPress={() => create.mutate()} />
          </Card>
        ) : (
          <Card>
            <Text variant="small" selectable>{hook.data.url}</Text>
            <Badge tone={hook.data.active ? 'accent' : 'neutral'} label={t(hook.data.active ? 'mp.dev.hook.active' : 'mp.dev.hook.disabled')} />
            {hook.data.events.map((e) => <Text key={e} variant="caption" muted>• {t(`mp.event.${e}` as MessageKey)}</Text>)}
            {hook.data.failureCount > 0 ? <Text variant="caption" muted>{t('mp.dev.hook.failures', { n: hook.data.failureCount })}</Text> : null}
            <Button variant="secondary" label={t('mp.dev.hook.test')} loading={test.isPending} onPress={() => test.mutate()} />
            {testResult ? <Text variant="small">{testResult}</Text> : null}
            <Button variant="secondary" label={t('miniapps.dev.secret.rotate')} loading={rotate.isPending} onPress={() => rotate.mutate()} />
            <Button variant="ghost" label={t('mp.dev.hook.delete')} onPress={askDelete} />
          </Card>
        )}
        {failure ? <Text variant="small" color="#B3261E">{errorMessage(failure, t, locale)}</Text> : null}

        {hook.data ? (
          <>
            <SectionTitle>{t('mp.dev.hook.journal')}</SectionTitle>
            {deliveries.data?.items.length === 0 ? <Text muted>{t('mp.dev.hook.journalEmpty')}</Text> : null}
            {deliveries.data?.items.map((d) => (
              <Card key={d.id}>
                <Text variant="bodyStrong">{d.event}</Text>
                <Text variant="small" muted>{d.status} · {d.httpStatus ?? d.errorCode ?? '-'} · {t('mp.dev.hook.attempt', { n: d.attempt })}</Text>
                <Text variant="caption" muted>{new Date(d.createdAt).toLocaleString(locale)}</Text>
              </Card>
            ))}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
