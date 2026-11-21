import type { HelpRequest } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { adminErrorMessage, Denied, isDenied } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { fetchAdminHelp, mdKeys, resolveHelp } from '../../../messaging/module-d-api';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

function Item({ r }: { r: HelpRequest }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const done = useMutation({ mutationFn: () => resolveHelp(r.id, { reply: reply.trim() }), onSuccess: () => void qc.invalidateQueries({ queryKey: mdKeys.adminHelp }) });
  return (
    <Card>
      <Text variant="bodyStrong">{r.subject}</Text>
      <Text variant="small" muted>{`${t('md.adm.help.from', { id: (r.userId ?? '').slice(0, 8) })} · ${new Date(r.createdAt).toLocaleString(locale)}`}</Text>
      <Text>{r.body}</Text>
      <TextField label={t('md.adm.help.reply')} value={reply} onChangeText={setReply} maxLength={2000} multiline />
      {done.isError ? <Text color={colors.danger} accessibilityRole="alert">{adminErrorMessage(done.error, t, locale)}</Text> : null}
      <Button label={t('md.adm.help.send')} onPress={() => done.mutate()} loading={done.isPending} disabled={reply.trim().length < 2} />
    </Card>
  );
}

/** Administration : file des demandes d'aide (support) ; la réponse clôture la demande et reste visible de l'utilisateur. */
export default function AdminHelp() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: mdKeys.adminHelp, queryFn: fetchAdminHelp, retry: false });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('md.adm.help.title') }} />
      <View style={{ gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {isDenied(q.error) ? <Denied /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data && q.data.items.length === 0 ? <Text muted>{t('md.adm.help.empty')}</Text> : null}
        {q.data?.items.map((r) => <Item key={r.id} r={r} />)}
      </View>
    </Screen>
  );
}
