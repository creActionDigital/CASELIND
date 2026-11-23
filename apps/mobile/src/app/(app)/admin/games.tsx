import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, createTournament, fetchQuestions, setQuestionActive } from '../../../admin/console-api';
import { tournamentBody } from '../../../admin/tournament-logic';
import { Denied, adminErrorMessage, adminStyles, isDenied, useHasRole } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading } from '../../../seller/ui';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Ouvre un tournoi : titre, début et fin (heure locale). Le classement est le meilleur score terminé dans la fenêtre. */
function TournamentForm() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const body = tournamentBody(title, starts, ends);
  const create = useMutation({
    mutationFn: createTournament,
    onSuccess: (r) => {
      setMsg({ ok: true, text: t('adm.games.tDone', { title: r.title }) });
      setTitle('');
      setStarts('');
      setEnds('');
      void qc.invalidateQueries({ queryKey: ['games', 'tournaments'] });
    },
    onError: (e) => setMsg({ ok: false, text: adminErrorMessage(e, t, locale) }),
  });
  return (
    <Card style={adminStyles.cardFlat}>
      <Text variant="bodyStrong">{t('adm.games.openTournament')}</Text>
      <TextField label={t('adm.games.tTitle')} value={title} onChangeText={setTitle} maxLength={80} />
      <TextField label={t('adm.games.tStarts')} value={starts} onChangeText={setStarts} autoCapitalize="none" />
      <TextField label={t('adm.games.tEnds')} value={ends} onChangeText={setEnds} autoCapitalize="none" />
      {(title || starts || ends) && !body ? <Text variant="small" color={colors.danger}>{t('adm.games.tInvalid')}</Text> : null}
      {msg ? <Text variant="small" color={msg.ok ? colors.success : colors.danger} accessibilityLiveRegion="polite">{msg.text}</Text> : null}
      <Button variant="secondary" label={t('adm.games.tCreate')} disabled={!body} loading={create.isPending} onPress={() => body && create.mutate(body)} />
    </Card>
  );
}

/** Tournois et questions de jeu : ouvrir un tournoi ; activer ou désactiver une question (la réponse attendue n'est pas affichée). */
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
      <TournamentForm />
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
