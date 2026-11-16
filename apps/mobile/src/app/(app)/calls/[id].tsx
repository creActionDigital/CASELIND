import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { callAction, clKeys, fetchCalls } from '../../../calllive/api';
import { useI18n, type MessageKey } from '../../../i18n';
import { useRealtime } from '../../../realtime/realtime-context';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Button, ErrorState, Screen, Text } from '../../../ui';

/** Écran d'appel : état de la sonnerie et de la communication, boutons répondre / refuser / raccrocher. La signalisation est réelle, pas le média. */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { socket } = useRealtime();
  const calls = useQuery({ queryKey: clKeys.calls, queryFn: fetchCalls, refetchInterval: 5000 });
  const call = calls.data?.items.find((c) => c.id === id);
  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => void qc.invalidateQueries({ queryKey: clKeys.calls });
    socket.on('call.updated', onUpdated);
    return () => { socket.off('call.updated', onUpdated); };
  }, [socket, qc]);
  const act = useMutation({ mutationFn: (a: 'accept' | 'decline' | 'end') => callAction(id, a), onSuccess: () => qc.invalidateQueries({ queryKey: clKeys.calls }) });
  const incoming = call?.calleeId === me?.id;
  const over = call && !['ringing', 'active'].includes(call.status);
  return (
    <Screen>
      <Stack.Screen options={{ title: t('calls.title') }} />
      {calls.isPending ? <Loading /> : null}
      {calls.isError ? <ErrorState error={calls.error} onRetry={() => calls.refetch()} /> : null}
      {call ? (
        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="title">{t(`calls.status.${call.status}` as MessageKey)}</Text>
            <Text muted>{t(call.kind === 'video' ? 'calls.video' : 'calls.audio')}{incoming ? ` · ${t('calls.incoming')}` : ''}</Text>
            <Text variant="caption" muted>{t('calls.mediaNote')}</Text>
          </Card>
          {call.status === 'ringing' && incoming ? (
            <>
              <Button label={t('calls.accept')} loading={act.isPending} onPress={() => act.mutate('accept')} />
              <Button variant="danger" label={t('calls.decline')} onPress={() => act.mutate('decline')} />
            </>
          ) : null}
          {call.status === 'ringing' && !incoming ? <Button variant="danger" label={t('calls.hangup')} onPress={() => act.mutate('end')} /> : null}
          {call.status === 'active' ? <Button variant="danger" label={t('calls.hangup')} loading={act.isPending} onPress={() => act.mutate('end')} /> : null}
          {over ? <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
