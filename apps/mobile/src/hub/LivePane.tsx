import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { clKeys, fetchLives, startLive } from '../calllive/api';
import { errorMessage } from '../lib/errors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { brandColor, glass, onMedia, radius, TAB_BAR_SPACE, TOUCH } from '../theme/tokens';
import { Text } from '../ui';

/** Onglet Live : lives en cours (chat et compteur réels ; la vidéo attend un serveur média) et lancement d'un live. */
export function LivePane() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const lives = useQuery({ queryKey: clKeys.lives, queryFn: fetchLives, refetchInterval: 15000 });
  const start = useMutation({
    mutationFn: () => startLive(title.trim()),
    onSuccess: (l) => { setTitle(''); void qc.invalidateQueries({ queryKey: clKeys.lives }); router.push({ pathname: '/lives/[id]', params: { id: l.id } }); },
  });
  const items = lives.data?.items ?? [];
  return (
    <View style={[styles.root, { paddingTop: insets.top + 88, paddingBottom: TAB_BAR_SPACE }]}>
      <Ionicons name="radio-outline" size={56} color="rgba(255,255,255,0.6)" />
      <Text variant="title" color={onMedia} style={styles.center} accessibilityRole="header">
        {items.length === 0 ? t('lives.none') : t('lives.title')}
      </Text>
      {items.map((l) => (
        <Pressable key={l.id} accessibilityRole="button" accessibilityLabel={l.title} onPress={() => router.push({ pathname: '/lives/[id]', params: { id: l.id } })} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}>
          <Ionicons name="radio-outline" size={26} color={onMedia} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" color={onMedia}>{l.title}</Text>
            <Text variant="caption" color="#D4D4DC">{t('lives.by', { handle: l.hostHandle })} · {t('lives.viewers', { n: l.viewers })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={onMedia} />
        </Pressable>
      ))}
      <TextInput
        accessibilityLabel={t('lives.titlePlaceholder')}
        placeholder={t('lives.titlePlaceholder')}
        placeholderTextColor="#9A9AA6"
        value={title}
        onChangeText={setTitle}
        maxLength={100}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: title.trim().length === 0 || start.isPending }}
        accessibilityLabel={t('lives.start')}
        disabled={title.trim().length === 0 || start.isPending}
        onPress={() => start.mutate()}
        style={[styles.start, { opacity: title.trim().length === 0 ? 0.55 : 1 }]}
      >
        <Text variant="bodyStrong" color={onMedia}>{t('lives.start')}</Text>
      </Pressable>
      {start.isError ? <Text variant="caption" color="#FCA5A5">{errorMessage(start.error, t, locale)}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('live.previewCard')}
        onPress={() => router.push('/live/preview')}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="color-palette-outline" size={26} color={onMedia} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" color={onMedia}>
            {t('live.previewCard')}
          </Text>
          <Text variant="caption" color="#D4D4DC">
            {t('live.previewBody')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={onMedia} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#14141B' },
  center: { textAlign: 'center' },
  input: { alignSelf: 'stretch', minHeight: TOUCH, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: glass.dark, borderWidth: 1, borderColor: glass.border, color: onMedia },
  flex: { flex: 1 },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: brandColor,
  },
  soon: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#FACC15' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    minHeight: TOUCH + 16,
    padding: 14,
    marginTop: 12,
    borderRadius: radius.lg,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
});
