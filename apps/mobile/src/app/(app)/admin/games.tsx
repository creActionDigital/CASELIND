import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { cck, fetchQuestions, setQuestionActive } from '../../../admin/console-api';
import { Denied, adminErrorMessage, adminStyles, isDenied, useHasRole } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading } from '../../../seller/ui';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** Questions de jeu : activer ou désactiver (la réponse attendue n'est pas affichée). */
export default function GameQuestions() {
  const { t, locale } = useI18n();
  const allowed = useHasRole(['admin']);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: cck.list('games'), queryFn: fetchQuestions, enabled: allowed });
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => setQuestionActive(v.id, v.active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  if (!allowed || isDenied(q.error)) return <Denied />;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.games.title') }} />
      <Button variant="ghost" label={t('adm.refresh')} loading={q.isRefetching} onPress={() => void q.refetch()} />
      {toggle.isError ? <Text variant="small" accessibilityLiveRegion="polite">{adminErrorMessage(toggle.error, t, locale)}</Text> : null}
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? <EmptyState icon="game-controller-outline" title={t('adm.empty')} /> : q.data.items.map((x) => {
        const verb = t(x.active ? 'adm.games.disable' : 'adm.games.enable');
        return (
          <Card key={x.id} style={adminStyles.cardFlat}>
            <Text variant="bodyStrong">{x.prompt}</Text>
            <Text variant="small" muted>{x.category}</Text>
            <View style={adminStyles.badges}>
              <Badge tone={x.active ? 'primary' : 'neutral'} label={t(x.active ? 'adm.games.active' : 'adm.games.inactive')} />
            </View>
            <Button
              variant="secondary"
              label={verb}
              loading={toggle.isPending && toggle.variables?.id === x.id}
              onPress={() => alertConfirm(t('adm.confirmTitle'), t('adm.confirmBody', { action: verb, name: x.prompt }), [
                { text: t('adm.cancel'), style: 'cancel' },
                { text: verb, onPress: () => toggle.mutate({ id: x.id, active: !x.active }) },
              ])}
            />
          </Card>
        );
      })}
    </Screen>
  );
}
