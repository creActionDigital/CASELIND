import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useI18n } from '../i18n';
import { getAuthMediaUri } from '../media/auth-media';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import type { CachedMessage } from './cache';
import { formatDuration, nextSpeed, speedLabel, waveBars } from './voice-logic';

/** Un seul vocal joue à la fois : celui qui démarre arrête le précédent. */
let stopCurrent: (() => void) | null = null;

/** Bulle vocale : lecture/pause, onde cliquable (déplacement dans le vocal), durée, vitesse 1x / 1,5x / 2x. */
export function VoiceBubble({ message: m, fg, sub }: { message: CachedMessage; fg: string; sub: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const total = m.media?.durationSec ?? m.localDuration ?? 0;
  const url = m.media?.contentUrl;
  const sending = m.local === 'sending' || !url;
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const bars = waveBars(m.id);

  useEffect(
    () => () => {
      if (stopCurrent === halt.current) stopCurrent = null;
      player.current?.remove();
      player.current = null;
    },
    [],
  );
  const halt = useRef(() => {
    player.current?.pause();
    setPlaying(false);
  });

  async function toggle() {
    if (!url || busy) return;
    setFailed(false);
    try {
      if (!player.current) {
        setBusy(true);
        const uri = await getAuthMediaUri(url);
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
        const p = createAudioPlayer(uri);
        p.addListener('playbackStatusUpdate', (s) => {
          setPos(s.currentTime);
          setPlaying(s.playing);
          if (s.didJustFinish) {
            setPos(0);
            void p.seekTo(0);
          }
        });
        player.current = p;
      }
      const p = player.current;
      if (playing) return p.pause();
      if (stopCurrent && stopCurrent !== halt.current) stopCurrent();
      stopCurrent = halt.current;
      p.setPlaybackRate(rate);
      p.play();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  function changeSpeed() {
    const r = nextSpeed(rate);
    setRate(r);
    player.current?.setPlaybackRate(r);
  }
  function seek(x: number) {
    if (!player.current || !width || !total) return;
    void player.current.seekTo(Math.max(0, Math.min(total, (x / width) * total)));
  }

  const ratio = total > 0 ? Math.min(1, pos / total) : 0;
  const shown = playing || pos > 0 ? pos : total;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t('chat.voice.pause') : t('chat.voice.play')}
        disabled={sending}
        onPress={() => void toggle()}
        style={[styles.play, { backgroundColor: colors.action }]}
      >
        {sending || busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#FFFFFF" />}
      </Pressable>
      <View style={styles.mid}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('chat.voice.seek')}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => seek(e.nativeEvent.locationX)}
          style={styles.wave}
        >
          {bars.map((h, i) => (
            <View key={i} style={[styles.bar, { height: 4 + h * 22, backgroundColor: i / bars.length < ratio ? colors.action : fg, opacity: i / bars.length < ratio ? 1 : 0.4 }]} />
          ))}
        </Pressable>
        <Text variant="caption" color={failed ? colors.danger : sub}>
          {failed ? t('chat.voice.error') : formatDuration(shown)}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('chat.voice.speed', { rate: speedLabel(rate) })} onPress={changeSpeed} hitSlop={6} style={[styles.speed, { borderColor: sub }]}>
        <Text variant="caption" color={fg} style={styles.speedText}>
          {speedLabel(rate)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 230 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, gap: 2 },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 30 },
  bar: { width: 3, borderRadius: 2 },
  speed: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  speedText: { fontWeight: '700' },
});
