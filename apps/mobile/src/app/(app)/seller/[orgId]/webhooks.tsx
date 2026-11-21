import { Ionicons } from '@expo/vector-icons';
import { alertConfirm } from '../../../../lib/confirm';
import { WEBHOOK_EVENTS, type Webhook, type WebhookEvent } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { shareMessage } from '../../../../lib/share';
import { ApiRequestError } from '../../../../lib/api';
import { useMembership } from '../../../../seller/api';
import { Card, Loading, SectionTitle, sellerErrorMessage } from '../../../../seller/ui';
import { spacing, TOUCH } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';
import { formatWhen } from '../../../../vitrine/updates-logic';
import { createWebhook, deleteWebhook, fetchWebhookDeliveries, fetchWebhooks, patchWebhook, rotateWebhookSecret, testWebhook, webhookKeys } from '../../../../webhooks/api';
import { buildWebhook, canManageWebhooks, hookState, hostOf, latestDeliveries, toggleEvent, urlErrorOf } from '../../../../webhooks/logic';

/** « Webhooks » (propriétaire) : abonnements HTTPS aux événements de l'organisation. Le secret n'est montré qu'une fois. */
export default function OrgWebhooks() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = canManageWebhooks(role);
  const list = useQuery({ queryKey: webhookKeys.list(orgId), queryFn: () => fetchWebhooks(orgId), enabled: !!orgId && allowed });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const [info, setInfo] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const log = useQuery({ queryKey: webhookKeys.deliveries(orgId, open ?? ''), queryFn: () => fetchWebhookDeliveries(orgId, open!), enabled: !!open && allowed });

  const refresh = () => void qc.invalidateQueries({ queryKey: webhookKeys.list(orgId) });
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'limit') return setInfo(t('webhooks.err.limit'));
    if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'rate_limited') return setInfo(t('webhooks.err.rateLimited'));
    const u = e instanceof ApiRequestError && e.status === 400 ? urlErrorOf(e.details) : null;
    setInfo(u ? t(`webhooks.err.${u}` as MessageKey) : sellerErrorMessage(e, t, locale));
  };

  const create = useMutation({
    mutationFn: () => {
      const built = buildWebhook(url, events);
      if ('error' in built) throw new Error(built.error);
      return createWebhook(orgId, built.ok);
    },
    onSuccess: (w) => {
      setUrl('');
      setInfo(null);
      setSecret(w.secret);
      refresh();
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (/^(empty|invalid|https|credentials|port|host|events)$/.test(m)) setInfo(t(`webhooks.err.${m}` as MessageKey));
      else fail(e);
    },
  });
  const toggle = useMutation({ mutationFn: (h: Webhook) => patchWebhook(orgId, h.id, { active: !h.active }), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteWebhook(orgId, id), onSuccess: refresh, onError: fail });
  const rotate = useMutation({ mutationFn: (id: string) => rotateWebhookSecret(orgId, id), onSuccess: (w) => setSecret(w.secret), onError: fail });
  const test = useMutation({
    mutationFn: (id: string) => testWebhook(orgId, id),
    onSuccess: (d, id) => {
      setInfo(d.status === 'delivered' ? t('webhooks.testOk', { status: d.httpStatus ?? 0 }) : t('webhooks.testKo', { reason: d.errorCode ?? '?' }));
      void qc.invalidateQueries({ queryKey: webhookKeys.deliveries(orgId, id) });
      refresh();
    },
    onError: fail,
  });

  const title = <Stack.Screen options={{ title: t('webhooks.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('webhooks.forbidden')}</Text></Screen></>;
  if (list.isPending) return <>{title}<Loading /></>;
  if (list.isError) return <>{title}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;

  const confirm = (message: string, action: string, run: () => void, destructive = true) =>
    alertConfirm(message, undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: action, style: destructive ? 'destructive' : 'default', onPress: run }]);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Text muted>{t('webhooks.intro')}</Text>

          {secret ? (
            <Card>
              <Text variant="bodyStrong">{t('webhooks.secret.title')}</Text>
              <Text selectable style={{ fontFamily: 'monospace' }}>{secret}</Text>
              <Text variant="small" color={colors.danger}>{t('webhooks.secret.once')}</Text>
              <Button variant="secondary" label={t('webhooks.secret.share')} onPress={() => void shareMessage({ message: secret }, t('share.copied'))} />
              <Button label={t('webhooks.secret.done')} onPress={() => setSecret(null)} />
            </Card>
          ) : null}

          <SectionTitle>{t('webhooks.add')}</SectionTitle>
          <TextField label={t('webhooks.fieldUrl')} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" maxLength={500} />
          <Text variant="bodyStrong">{t('webhooks.events')}</Text>
          {WEBHOOK_EVENTS.map((e) => {
            const on = events.includes(e);
            return (
              <Pressable key={e} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setEvents((cur) => toggleEvent(cur, e))} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH }}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.primary : colors.textMuted} />
                <Text>{t(`webhooks.event.${e}` as MessageKey)}</Text>
              </Pressable>
            );
          })}
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('webhooks.create')} loading={create.isPending} onPress={() => { setInfo(null); create.mutate(); }} />

          <SectionTitle>{t('webhooks.title')}</SectionTitle>
          {list.data.items.length === 0 ? <Text muted>{t('webhooks.empty')}</Text> : null}
          {list.data.items.map((h) => {
            const state = hookState(h);
            return (
              <Card key={h.id}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge label={t(`webhooks.state.${state}` as MessageKey)} tone={state === 'ok' ? 'primary' : 'neutral'} />
                  {h.failureCount > 0 ? <Text variant="small" muted>{t('webhooks.failures', { n: h.failureCount })}</Text> : null}
                </View>
                <Text variant="bodyStrong">{hostOf(h.url)}</Text>
                <Text variant="small" muted>{h.events.map((e) => t(`webhooks.event.${e}` as MessageKey)).join(' · ')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  <Button variant="secondary" label={t(h.active ? 'webhooks.disable' : 'webhooks.enable')} loading={toggle.isPending && toggle.variables?.id === h.id} onPress={() => toggle.mutate(h)} />
                  <Button variant="secondary" label={t('webhooks.test')} loading={test.isPending && test.variables === h.id} onPress={() => { setInfo(null); test.mutate(h.id); }} />
                  <Button variant="secondary" label={t('webhooks.rotate')} onPress={() => confirm(t('webhooks.rotateAsk'), t('webhooks.rotate'), () => rotate.mutate(h.id))} />
                  <Button variant="secondary" label={t('webhooks.delete')} onPress={() => confirm(hostOf(h.url), t('webhooks.delete'), () => remove.mutate(h.id))} />
                  <Button variant="ghost" label={t('webhooks.deliveries')} onPress={() => setOpen(open === h.id ? null : h.id)} />
                </View>
                {open === h.id ? (
                  log.isPending ? <Loading /> : log.isError ? <Text color={colors.danger}>{sellerErrorMessage(log.error, t, locale)}</Text> : latestDeliveries(log.data.items).length === 0 ? (
                    <Text muted>{t('webhooks.noDeliveries')}</Text>
                  ) : (
                    latestDeliveries(log.data.items).map((d) => (
                      <Text key={d.id} variant="small" muted>
                        {formatWhen(d.createdAt)} · {d.event} · {t(`webhooks.delivery.${d.status}` as MessageKey)}
                        {d.httpStatus ? ` (HTTP ${d.httpStatus})` : d.errorCode ? ` (${d.errorCode})` : ''}
                      </Text>
                    ))
                  )
                ) : null}
              </Card>
            );
          })}
        </View>
      </Screen>
    </>
  );
}
