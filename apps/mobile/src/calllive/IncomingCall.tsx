import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { callSchema, type Call } from '@caselind/contracts';
import { useI18n } from '../i18n';
import { useRealtime } from '../realtime/realtime-context';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { clKeys } from './api';

/** Bandeau « appel entrant » affiché au-dessus de tout écran quand `call.ringing` arrive ; disparaît avec `call.updated`. */
export function IncomingCall() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { socket } = useRealtime();
  const [call, setCall] = useState<Call | null>(null);
  useEffect(() => {
    if (!socket) return;
    const onRing = (raw: unknown) => {
      const parsed = callSchema.safeParse(raw);
      if (parsed.success) setCall(parsed.data);
      void qc.invalidateQueries({ queryKey: clKeys.calls });
    };
    const onUpdated = (raw: unknown) => {
      const parsed = callSchema.safeParse(raw);
      if (parsed.success) setCall((c) => (c?.id === parsed.data.id ? null : c));
    };
    socket.on('call.ringing', onRing);
    socket.on('call.updated', onUpdated);
    return () => { socket.off('call.ringing', onRing); socket.off('call.updated', onUpdated); };
  }, [socket, qc]);
  if (!call) return null;
  return (
    <View accessibilityLiveRegion="assertive" style={{ position: 'absolute', top: 48, left: spacing.lg, right: spacing.lg, zIndex: 50, padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }}>
      <Text variant="bodyStrong">{t('calls.incoming')} · {t(call.kind === 'video' ? 'calls.video' : 'calls.audio')}</Text>
      <Button label={t('calls.accept')} onPress={() => { const id = call.id; setCall(null); router.push({ pathname: '/calls/[id]', params: { id } }); }} />
    </View>
  );
}
