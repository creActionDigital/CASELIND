import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { cck, fetchAiModels, setAiModel } from '../../../admin/console-api';
import { Denied, adminErrorMessage, adminStyles, isDenied, useHasRole } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading } from '../../../seller/ui';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** Modèles d'IA : activation par l'administrateur. Un modèle sans fournisseur configuré reste indisponible. */
export default function AiModels() {
  const { t, locale } = useI18n();
  const allowed = useHasRole(['admin']);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: cck.list('ai'), queryFn: fetchAiModels, enabled: allowed });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => setAiModel(v.id, v.enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  if (!allowed || isDenied(q.error)) return <Denied />;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.ai.title') }} />
      <Button variant="ghost" label={t('adm.refresh')} loading={q.isRefetching} onPress={() => void q.refetch()} />
      {toggle.isError ? <Text variant="small" accessibilityLiveRegion="polite">{adminErrorMessage(toggle.error, t, locale)}</Text> : null}
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? <EmptyState icon="sparkles-outline" title={t('adm.empty')} /> : q.data.items.map((m) => {
        const verb = t(m.enabled ? 'adm.ai.disable' : 'adm.ai.enable');
        return (
          <Card key={m.id} style={adminStyles.cardFlat}>
            <Text variant="bodyStrong">{m.label}</Text>
            <Text variant="small" muted>{m.provider} · {m.model}</Text>
            <Text variant="small" muted>{t('adm.ai.trains', { v: String(m.trainsOnData) })}</Text>
            <View style={adminStyles.badges}>
              <Badge tone={m.enabled ? 'primary' : 'neutral'} label={t(m.enabled ? 'adm.flags.on' : 'adm.flags.off')} />
              {m.free ? <Badge tone="neutral" label={t('adm.ai.free')} /> : null}
              {!m.providerConfigured ? <Badge tone="accent" label={t('adm.ai.noProvider')} /> : null}
            </View>
            <Button
              variant="secondary"
              label={verb}
              loading={toggle.isPending && toggle.variables?.id === m.id}
              onPress={() => alertConfirm(t('adm.confirmTitle'), t('adm.confirmBody', { action: verb, name: m.label }), [
                { text: t('adm.cancel'), style: 'cancel' },
                { text: verb, onPress: () => toggle.mutate({ id: m.id, enabled: !m.enabled }) },
              ])}
            />
          </Card>
        );
      })}
    </Screen>
  );
}
