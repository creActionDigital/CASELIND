import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { clKeys, endLive, fetchLive, fetchLiveMessages, joinLive, leaveLive, sendLiveMessage } from '../../../calllive/api';
import { useI18n } from '../../../i18n';
import { useRealtime } from '../../../realtime/realtime-context';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Salon d'un live : compteur et chat en temps réel ; la vidéo attend un serveur média (voir la note affichée). */
export default function LiveRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { socket } = useRealtime();
  const [text, setText] = useState('');
  const live = useQuery({ queryKey: clKeys.live(id), queryFn: () => fetchLive(id) });
  const isHost = live.data?.hostId === me?.id;
  const open = live.data?.status === 'live';
  const joined = useMutation({ mutationFn: () => joinLive(id), onSuccess: (l) => qc.setQueryData(clKeys.live(id), l) });
  const messages = useQuery({ queryKey: clKeys.liveMessages(id), queryFn: () => fetchLiveMessages(id), enabled: open && (isHost || joined.isSuccess), retry: false });

  // Un spectateur rejoint à l'ouverture et quitte en partant.
  useEffect(() => {
    if (live.data && open && !isHost) joined.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data?.id, open, isHost]);
  useEffect(() => () => { if (!isHost) void leaveLive(id).catch(() => undefined); }, [id, isHost]);

  useEffect(() => {
    if (!socket) return;
    const refresh = (ev: { liveId?: string } | null) => {
      if (ev?.liveId !== id) return;
      void qc.invalidateQueries({ queryKey: clKeys.live(id) });
    };
    const onMessage = (ev: { liveId?: string } | null) => { if (ev?.liveId === id) void qc.invalidateQueries({ queryKey: clKeys.liveMessages(id) }); };
    socket.on('live.viewers', refresh);
    socket.on('live.ended', refresh);
    socket.on('live.message', onMessage);
    return () => { socket.off('live.viewers', refresh); socket.off('live.ended', refresh); socket.off('live.message', onMessage); };
  }, [socket, id, qc]);

  const send = useMutation({ mutationFn: () => sendLiveMessage(id, text.trim()), onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: clKeys.liveMessages(id) }); } });
  const end = useMutation({ mutationFn: () => endLive(id), onSuccess: (l) => { qc.setQueryData(clKeys.live(id), l); void qc.invalidateQueries({ queryKey: clKeys.lives }); } });

  return (
    <Screen>
      <Stack.Screen options={{ title: live.data?.title ?? t('lives.title') }} />
      {live.isPending ? <Loading /> : null}
      {live.isError ? <ErrorState error={live.error} onRetry={() => live.refetch()} /> : null}
      {live.data ? (
        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="bodyStrong">{live.data.title}</Text>
            <Text variant="small" muted>{t('lives.by', { handle: live.data.hostHandle })}</Text>
            <Text>{t('lives.viewers', { n: live.data.viewers })}</Text>
            <Text variant="caption" muted>{t('lives.peak', { n: live.data.peakViewers })}</Text>
            {isHost && open ? <Text variant="small" style={{ fontWeight: '600' }}>{t('lives.host')}</Text> : null}
            {!open ? <Text>{t('lives.ended')}</Text> : null}
            <Text variant="caption" muted>{t('lives.mediaNote')}</Text>
          </Card>
          {open ? (
            <>
              {messages.data && messages.data.items.length === 0 ? <Text muted>{t('lives.chat.empty')}</Text> : null}
              {messages.data?.items.map((m) => (
                <Text key={m.id}><Text style={{ fontWeight: '600' }}>@{m.handle} </Text>{m.body}</Text>
              ))}
              <TextField label={t('lives.chat.placeholder')} value={text} onChangeText={setText} maxLength={300} />
              <Button label={t('lives.chat.send')} disabled={text.trim().length === 0} loading={send.isPending} onPress={() => send.mutate()} />
              {isHost ? <Button variant="danger" label={t('lives.end')} loading={end.isPending} onPress={() => end.mutate()} /> : <Button variant="ghost" label={t('lives.leave')} onPress={() => router.back()} />}
            </>
          ) : (
            <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}
