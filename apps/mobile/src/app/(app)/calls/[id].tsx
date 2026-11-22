import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/auth-context';
import { callAction, clKeys, fetchCalls } from '../../../calllive/api';
import { formatDuration } from '../../../calllive/call-machine';
import { StreamView } from '../../../calllive/StreamView';
import { useRtcCall } from '../../../calllive/useRtcCall';
import { useI18n, type MessageKey } from '../../../i18n';
import { useRealtime } from '../../../realtime/realtime-context';
import { Card, Loading } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../ui';
import { safeBack } from '../../../lib/back-target';

type IconName = keyof typeof Ionicons.glyphMap;

function RoundButton({ icon, label, onPress, danger, off }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; off?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.danger : off ? '#FFFFFF' : 'rgba(255,255,255,0.22)' }}
    >
      <Ionicons name={icon} size={26} color={off ? '#111' : '#fff'} style={danger ? { transform: [{ rotate: '135deg' }] } : undefined} />
    </Pressable>
  );
}

/** Écran d'appel : sonnerie, puis communication audio ou vidéo (WebRTC : navigateur ou react-native-webrtc). */
export default function CallScreen() {
  const { id, auto } = useLocalSearchParams<{ id: string; auto?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { socket } = useRealtime();
  const calls = useQuery({ queryKey: clKeys.calls, queryFn: fetchCalls, refetchInterval: 5000 });
  const call = calls.data?.items.find((c) => c.id === id);
  const media = useRtcCall(call, me?.id);
  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => void qc.invalidateQueries({ queryKey: clKeys.calls });
    socket.on('call.updated', onUpdated);
    return () => { socket.off('call.updated', onUpdated); };
  }, [socket, qc]);
  const act = useMutation({ mutationFn: (a: 'accept' | 'decline' | 'end') => callAction(id, a), onSuccess: () => qc.invalidateQueries({ queryKey: clKeys.calls }) });
  const incoming = call?.calleeId === me?.id;
  // « Répondre » depuis le bandeau d'appel entrant : on décroche tout de suite, une seule fois.
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    if (auto === '1' && !autoDone && call?.status === 'ringing' && incoming) {
      setAutoDone(true);
      act.mutate('accept');
    }
  }, [auto, autoDone, call?.status, incoming, act]);
  const over = call && !['ringing', 'active'].includes(call.status);

  if (call?.status === 'active') {
    const video = call.kind === 'video';
    const statusText =
      media.error === 'denied' ? t('calls.noMedia')
      : media.error === 'unsupported' ? t('calls.unsupported')
      : media.phase === 'connected' ? formatDuration(media.seconds)
      : media.phase === 'reconnecting' ? t('calls.reconnecting')
      : media.phase === 'failed' ? t('calls.connectionFailed')
      : t('calls.connecting');
    return (
      <View style={{ flex: 1, backgroundColor: video ? '#000' : colors.primary }}>
        <Stack.Screen options={{ headerShown: false }} />
        {video && media.remote ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}><StreamView stream={media.remote} /></View> : <StreamView stream={media.remote} hidden />}
        {video && media.local && media.camOn ? (
          <View style={{ position: 'absolute', top: insets.top + spacing.md, right: spacing.lg, width: 110, height: 150, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' }}>
            <StreamView stream={media.local} muted mirror />
          </View>
        ) : null}
        <View style={{ paddingTop: insets.top + spacing.xl, alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl }}>
          <Text variant="title" color="#fff">{t(video ? 'calls.video' : 'calls.audio')}</Text>
          <Text color="#fff" accessibilityLiveRegion="polite">{statusText}</Text>
        </View>
        {!video ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="person" size={72} color="#fff" />
            </View>
          </View>
        ) : <View style={{ flex: 1 }} />}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingTop: spacing.md }}>
          <RoundButton icon={media.micOn ? 'mic' : 'mic-off'} label={t(media.micOn ? 'calls.mute' : 'calls.unmute')} off={!media.micOn} onPress={media.toggleMic} />
          {video ? <RoundButton icon={media.camOn ? 'videocam' : 'videocam-off'} label={t(media.camOn ? 'calls.cameraOff' : 'calls.cameraOn')} off={!media.camOn} onPress={media.toggleCam} /> : null}
          {media.canSpeaker ? <RoundButton icon={media.speakerOn ? 'volume-high' : 'volume-low'} label={t(media.speakerOn ? 'calls.speakerOff' : 'calls.speakerOn')} off={media.speakerOn} onPress={media.toggleSpeaker} /> : null}
          {video ? <RoundButton icon="camera-reverse" label={t('calls.flip')} onPress={() => void media.flip()} /> : null}
          <RoundButton icon="call" label={t('calls.hangup')} danger onPress={() => act.mutate('end')} />
        </View>
      </View>
    );
  }

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
          </Card>
          {call.status === 'ringing' && incoming ? (
            <>
              <Button label={t('calls.accept')} loading={act.isPending} onPress={() => act.mutate('accept')} />
              <Button variant="danger" label={t('calls.decline')} onPress={() => act.mutate('decline')} />
            </>
          ) : null}
          {call.status === 'ringing' && !incoming ? <Button variant="danger" label={t('calls.hangup')} onPress={() => act.mutate('end')} /> : null}
          {over ? <Button variant="secondary" label={t('common.back')} onPress={() => safeBack(router, '/messages')} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
