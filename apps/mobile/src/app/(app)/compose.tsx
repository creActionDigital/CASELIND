import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchHashtagSuggestions } from '../../creator/api';
import { completeHashtag, typingHashtag } from '../../creator/logic';
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
import { VisibilityPicker, visibilityKey } from '../../social/VisibilityPicker';
import { onMedia, radius, spacing, TOUCH, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../ui';
import { PlaceSheet } from '../../mobility/ui';
import { PlaceRow } from '../../mobility/extra/ui';
import { PostAttachmentView } from '../../social/PostAttachmentView';
import { toAttachmentInput, validateAttachment, type AttachmentDraft } from '../../social/attachments';
import type { MessageKey } from '../../i18n';
import { safeBack } from '../../lib/back-target';

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
  const [attach, setAttach] = useState<AttachmentDraft>(() =>
    mode === 'event' ? { type: 'event', title: '', when: '', place: '' } : mode === 'poll' ? { type: 'poll', options: ['', ''] } : mode === 'location' ? { type: 'location', lat: null, lng: null, label: '' } : { type: 'none' },
  );
  const typing = typingHashtag(body);
  const suggest = useQuery({ queryKey: ['hashtag-suggest', typing], queryFn: () => fetchHashtagSuggestions(typing!), enabled: typing !== null });
  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const trimmed = body.trim();
  const attachError = validateAttachment(attach);
  // Un sondage a besoin de sa question ; une localisation ou un événement tiennent lieu de contenu.
  const needsText = attach.type === 'poll' && trimmed.length === 0;
  const album = mode === 'album';
  const canPublish = !sent && !!me && (!album || media.length >= 2) && !attachError && !needsText && (trimmed.length > 0 || media.length > 0 || attach.type !== 'none');
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
        attachment: toAttachmentInput(attach),
      });
      safeBack(router, '/');
    } catch (e) {
      setSent(false);
      setError(errorMessage(e, t, locale));
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: previewing ? t('mb.preview.title') : mode === 'video' ? t('compose.titleVideo') : ['album', 'event', 'poll', 'location'].includes(String(mode)) ? t(`mb.compose.title.${mode}` as MessageKey) : t('compose.title'),
          headerLeft: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={t('compose.close')} onPress={() => safeBack(router)} style={styles.headBtn}>
              <Text color={colors.primary}>{t('common.cancel')}</Text>
            </Pressable>
          ),
        }}
      />
      {previewing ? (
        <View style={styles.gap}>
          <View style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="bodyStrong">{me?.displayName}</Text>
            {trimmed ? <Text>{trimmed}</Text> : null}
            <View style={styles.thumbs}>
              {media.map((m, i) => (
                <View key={m.uri + i} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                  {m.video ? <Ionicons name="videocam" size={28} color={colors.primary} style={{ margin: 28 }} /> : <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                </View>
              ))}
            </View>
            {attach.type !== 'none' ? <PreviewAttachment draft={attach} /> : null}
            <Text variant="caption" muted>
              {t('mb.preview.visibility', { v: t(visibilityKey(visibility)) })}
            </Text>
          </View>
          {error ? (
            <Text color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label={t('compose.publish')} onPress={submit} disabled={!canPublish} />
          <Button label={t('mb.preview.back')} variant="secondary" onPress={() => setPreviewing(false)} />
        </View>
      ) : (
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
        {typing !== null && suggest.data && suggest.data.items.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {suggest.data.items.map((h) => (
              <Pressable key={h.tag} accessibilityRole="button" accessibilityLabel={`#${h.tag.replace(/^#/, '')}`} onPress={() => setBody(completeHashtag(body, h.tag))} style={{ minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
                <Text variant="small" color={colors.primary}>{`#${h.tag.replace(/^#/, '')}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
          {album ? null : <Button label={t('compose.video')} variant="secondary" onPress={() => pick('videos')} style={styles.flex} />}
        </View>

        {album && media.length < 2 ? (
          <Text variant="small" muted>
            {t('mb.album.min')}
          </Text>
        ) : null}
        <Text variant="small" style={{ fontWeight: '600' }}>
          {t('compose.visibility')}
        </Text>
        <VisibilityPicker value={visibility} onChange={setVisibility} />

        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <AttachmentForm draft={attach} onChange={setAttach} showErrors={showErrors} onPick={() => setPicking(true)} />
        {needsText ? (
          <Text variant="small" color={colors.danger}>
            {t('mb.poll.needsQuestion')}
          </Text>
        ) : null}
        <Button
          label={t('mb.preview.go')}
          onPress={() => {
            setShowErrors(true);
            if (canPublish) setPreviewing(true);
          }}
        />
        <Button label={t('compose.publish')} variant="secondary" onPress={() => (canPublish ? submit() : setShowErrors(true))} />
      </View>
      )}
      <PlaceSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setAttach((cur) => (cur.type === 'location' ? { ...cur, lat: p.lat, lng: p.lng, label: cur.label || p.label } : cur));
          setPicking(false);
        }}
      />
    </Screen>
  );
}

function PreviewAttachment({ draft }: { draft: AttachmentDraft }) {
  const input = toAttachmentInput(draft);
  const a =
    input?.type === 'poll'
      ? { type: 'poll' as const, options: input.options.map((label) => ({ label, votes: 0 })), myVote: null }
      : input?.type === 'event'
        ? { type: 'event' as const, title: input.title, startsAt: input.startsAt, place: input.place ?? null }
        : input?.type === 'location'
          ? input
          : null;
  return a ? <PostAttachmentView post={{ id: 'preview', attachment: a }} /> : null;
}

/** Saisie de la pièce jointe (événement, sondage ou localisation) ; sans pièce jointe, trois boutons d'ajout. */
function AttachmentForm({ draft, onChange, showErrors, onPick }: { draft: AttachmentDraft; onChange: (d: AttachmentDraft) => void; showErrors: boolean; onPick: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const err = showErrors ? validateAttachment(draft) : null;
  const msg = (k: string) => (err === k ? t(`mb.attach.err.${k}` as MessageKey) : null);
  if (draft.type === 'none') {
    return (
      <View style={styles.pickRow}>
        <Button label={t('mb.attach.addLocation')} variant="secondary" onPress={() => onChange({ type: 'location', lat: null, lng: null, label: '' })} style={styles.flex} />
        <Button label={t('mb.attach.addEvent')} variant="secondary" onPress={() => onChange({ type: 'event', title: '', when: '', place: '' })} style={styles.flex} />
        <Button label={t('mb.attach.addPoll')} variant="secondary" onPress={() => onChange({ type: 'poll', options: ['', ''] })} style={styles.flex} />
      </View>
    );
  }
  return (
    <View style={[styles.preview, { borderColor: colors.border }]}>
      <View style={styles.pickRow}>
        <Text variant="bodyStrong" style={styles.flex}>
          {t(`mb.attach.${draft.type}` as MessageKey)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('compose.remove')} onPress={() => onChange({ type: 'none' })} hitSlop={8}>
          <Ionicons name="close-circle" size={24} color={colors.textMuted} />
        </Pressable>
      </View>
      {draft.type === 'location' ? (
        <>
          <PlaceRow label={t('mb.attach.location')} point={draft.lat === null || draft.lng === null ? null : { lat: draft.lat, lng: draft.lng, label: draft.label }} icon="radio-button-on" onPress={onPick} />
          <TextField label={t('mb.attach.placeName')} value={draft.label} onChangeText={(label) => onChange({ ...draft, label })} maxLength={120} error={msg('location')} />
        </>
      ) : null}
      {draft.type === 'event' ? (
        <>
          <TextField label={t('mb.attach.eventTitle')} value={draft.title} onChangeText={(title) => onChange({ ...draft, title })} maxLength={120} error={msg('eventTitle')} />
          <TextField label={t('mb.attach.eventWhen')} value={draft.when} onChangeText={(when) => onChange({ ...draft, when })} placeholder="2026-12-24 18:30" maxLength={16} autoCorrect={false} keyboardType="numbers-and-punctuation" error={msg('eventDate')} />
          <TextField label={t('mb.attach.eventPlace')} value={draft.place} onChangeText={(place) => onChange({ ...draft, place })} maxLength={200} />
        </>
      ) : null}
      {draft.type === 'poll' ? (
        <>
          {draft.options.map((o, i) => (
            <TextField key={i} label={t('mb.attach.pollOption', { n: i + 1 })} value={o} onChangeText={(v) => onChange({ ...draft, options: draft.options.map((x, j) => (j === i ? v : x)) })} maxLength={80} error={i === 0 ? msg('pollOptions') : null} />
          ))}
          {draft.options.length < 4 ? <Button label={t('mb.attach.pollAdd')} variant="ghost" onPress={() => onChange({ ...draft, options: [...draft.options, ''] })} /> : null}
        </>
      ) : null}
    </View>
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
  pickRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  preview: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
});
