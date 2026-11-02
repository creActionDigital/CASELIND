import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/auth-context';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { uuidv4 } from '../../lib/uuid';
import { startPublish } from '../../social/publisher';
import type { PostVisibility } from '../../social/types';
import { postMime } from '../../social/upload';
import { VisibilityPicker } from '../../social/VisibilityPicker';
import { onMedia, radius, spacing, TOUCH, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Screen, Text } from '../../ui';

const MAX_BODY = 5000;
const MAX_PHOTOS = 10;

interface Picked {
  uri: string;
  mime: ReturnType<typeof postMime>;
  video: boolean;
}

/** Nouvelle publication (modale) : texte, jusqu'à 10 photos ou 1 vidéo, visibilité. L'envoi continue après la fermeture. */
export default function Compose() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const clientId = useRef(uuidv4());

  const [body, setBody] = useState('');
  const [media, setMedia] = useState<Picked[]>([]);
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = body.trim();
  const canPublish = !sent && !!me && (trimmed.length > 0 || media.length > 0);
  const hasVideo = media.some((m) => m.video);

  async function pick(kind: 'images' | 'videos') {
    setError(null);
    try {
      const remaining = MAX_PHOTOS - (hasVideo ? 0 : media.length);
      if (kind === 'images' && remaining <= 0) return setError(t('compose.mediaFull'));
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [kind],
        allowsMultipleSelection: kind === 'images',
        selectionLimit: kind === 'images' ? remaining : 1,
        quality: 0.8,
      });
      if (res.canceled) return;
      const picked: Picked[] = res.assets.map((a) => ({
        uri: a.uri,
        mime: postMime(a.mimeType, a.uri, kind === 'videos'),
        video: kind === 'videos',
      }));
      // Une vidéo remplace tout ; des photos remplacent une vidéo.
      setMedia((cur) => (kind === 'videos' ? picked.slice(0, 1) : [...cur.filter((m) => !m.video), ...picked].slice(0, MAX_PHOTOS)));
    } catch {
      setError(t('compose.pickError'));
    }
  }

  function submit() {
    if (!canPublish || !me) return;
    setSent(true);
    try {
      startPublish(qc, {
        clientId: clientId.current,
        author: { id: me.id, handle: me.handle, displayName: me.displayName, avatarUrl: me.avatarUrl },
        body: trimmed.length ? trimmed : null,
        visibility,
        media: media.map((m) => ({ uri: m.uri, mime: m.mime })),
      });
      router.back();
    } catch (e) {
      setSent(false);
      setError(errorMessage(e, t, locale));
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: mode === 'video' ? t('compose.titleVideo') : t('compose.title'),
          headerLeft: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={t('compose.close')} onPress={() => router.back()} style={styles.headBtn}>
              <Text color={colors.primary}>{t('common.cancel')}</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.gap}>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MAX_BODY}
          autoFocus={mode !== 'video'}
          accessibilityLabel={t('compose.placeholder')}
          placeholder={t('compose.placeholder')}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
        />
        <Text variant="caption" muted style={styles.counter} accessibilityLiveRegion="polite">
          {t('compose.counter', { n: body.length, max: MAX_BODY })}
        </Text>

        {media.length > 0 ? (
          <View style={styles.thumbs}>
            {media.map((m, i) => (
              <View key={m.uri + i} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                {m.video ? (
                  <View style={styles.thumbCenter}>
                    <Ionicons name="videocam" size={28} color={colors.primary} />
                  </View>
                ) : (
                  <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={t('feed.image', { n: i + 1, total: media.length })} />
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('compose.remove')}
                  onPress={() => setMedia((cur) => cur.filter((_, j) => j !== i))}
                  hitSlop={8}
                  style={[styles.remove, { backgroundColor: colors.overlay }]}
                >
                  <Ionicons name="close" size={16} color={onMedia} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.pickRow}>
          <Button label={t('compose.photos')} variant="secondary" onPress={() => pick('images')} style={styles.flex} />
          <Button label={t('compose.video')} variant="secondary" onPress={() => pick('videos')} style={styles.flex} />
        </View>

        <Text variant="small" style={{ fontWeight: '600' }}>
          {t('compose.visibility')}
        </Text>
        <VisibilityPicker value={visibility} onChange={setVisibility} />

        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('compose.publish')} onPress={submit} disabled={!canPublish} />
      </View>
    </Screen>
  );
}

const THUMB = 84;
const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.md },
  // Marges : le bouton ne touche ni le bord de l'écran ni le titre centré.
  headBtn: { minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.lg, marginRight: spacing.sm },
  input: { minHeight: 140, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, overflow: 'hidden' },
  thumbCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', gap: spacing.sm },
});
