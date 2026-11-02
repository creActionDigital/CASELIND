import { STORY_CAPTION_MAX, type StoryVisibility } from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { FormError } from '../../../auth/FormError';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { uuidv4 } from '../../../lib/uuid';
import { imageMime } from '../../../media/upload';
import { createStory } from '../../../stories/api';
import { storyKeys } from '../../../stories/keys';
import { uploadStoryImage } from '../../../stories/upload';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Button, IconButton, Screen, Text, TextField } from '../../../ui';

const VISIBILITIES: StoryVisibility[] = ['followers', 'friends'];

/** Création d'une story : image, légende (500), visibilité, envoi en deux temps puis POST /stories. */
export default function NewStory() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [asset, setAsset] = useState<{ uri: string; mime?: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<StoryVisibility>('followers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Clé d'idempotence : un nouvel essai réutilise le même clientId (pas de doublon si la réponse s'est perdue).
  const clientId = useRef(uuidv4());
  const mediaId = useRef<string | null>(null);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function pick() {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
      const a = res.canceled ? null : res.assets[0];
      if (!a) return;
      mediaId.current = null;
      setAsset({ uri: a.uri, mime: a.mimeType ?? undefined });
    } catch {
      setError(t('story.new.pickError'));
    }
  }

  async function publish() {
    if (!asset || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!mediaId.current) mediaId.current = await uploadStoryImage(asset.uri, imageMime(asset.mime, asset.uri));
      const text = caption.trim();
      await createStory({ clientId: clientId.current, mediaId: mediaId.current, caption: text || undefined, visibility });
      await qc.invalidateQueries({ queryKey: storyKeys.feed });
      close();
    } catch (err) {
      setError(errorMessage(err, t, locale));
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false} scroll={false}>
      <View style={styles.head}>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {t('story.new.title')}
        </Text>
        <IconButton icon="close" label={t('common.close')} onPress={close} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={asset ? t('story.new.changeImage') : t('story.new.pickImage')}
          onPress={pick}
          disabled={busy}
          style={[styles.preview, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          {asset ? (
            <AuthImage contentUrl={null} localUri={asset.uri} label={t('story.new.previewA11y')} style={StyleSheet.absoluteFill} />
          ) : (
            <Text muted style={{ textAlign: 'center' }}>
              {t('story.new.pickImage')}
            </Text>
          )}
        </Pressable>
        <TextField
          label={t('story.new.caption')}
          value={caption}
          onChangeText={setCaption}
          maxLength={STORY_CAPTION_MAX}
          multiline
        />
        <Text variant="caption" muted>
          {t('story.new.captionCount', { n: caption.length, max: STORY_CAPTION_MAX })}
        </Text>
        <Text variant="small" style={{ marginTop: spacing.sm }}>
          {t('story.new.visibility')}
        </Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {VISIBILITIES.map((v) => {
            const on = visibility === v;
            return (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t(`story.new.visibility.${v}`)}
                onPress={() => setVisibility(v)}
                style={[styles.option, { backgroundColor: on ? colors.primary : colors.primarySoft }]}
              >
                <Text variant="bodyStrong" color={on ? colors.onPrimary : colors.primary}>
                  {t(`story.new.visibility.${v}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <FormError message={error} />
        <Button label={t('story.new.publish')} onPress={publish} loading={busy} disabled={!asset} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.md },
  preview: { height: 320, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  segment: { flexDirection: 'row', gap: spacing.sm },
  option: { flex: 1, minHeight: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
