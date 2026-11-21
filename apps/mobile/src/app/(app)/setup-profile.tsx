import { meSchema } from '@caselind/contracts';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, useAuth } from '../../auth/auth-context';
import { FormError } from '../../auth/FormError';
import { useI18n } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { imageMime, uploadAvatarImage } from '../../media/upload';
import { spacing } from '../../theme/tokens';
import { Avatar, Button, Screen, Text, TextField } from '../../ui';

/** Création du profil après l'inscription : photo et nom d'utilisateur (étape facultative, une seule fois). */
export default function SetupProfile() {
  const { t, locale } = useI18n();
  const { me, setMe } = useAuth();
  const router = useRouter();
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [error, setError] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  if (!me) return null;
  const next = () => router.replace('/permissions' as never);

  async function pickPhoto() {
    setError(null);
    setPhotoBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (res.canceled) return;
      const a = res.assets[0]!;
      const assetId = await uploadAvatarImage(a.uri, imageMime(a.mimeType, a.uri));
      setMe(await api.request('/me/avatar', { method: 'PATCH', body: { assetId }, schema: meSchema }));
    } catch (e) {
      setError(errorMessage(e, t, locale));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    setError(null);
    setHandleError(null);
    const h = handle.trim();
    if (h === me!.handle) return next();
    setBusy(true);
    try {
      setMe(await api.request('/me', { method: 'PATCH', body: { handle: h }, schema: meSchema }));
      next();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'conflict') setHandleError(t('profile.handleTaken'));
      else if (e instanceof ApiRequestError && e.code === 'validation_failed') setHandleError(t('ma.setup.handleInvalid'));
      else setError(errorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.setup.title'), headerBackVisible: false }} />
      <Text variant="title" accessibilityRole="header">
        {t('ma.setup.heading')}
      </Text>
      <Text muted style={{ marginBottom: spacing.xl }}>
        {t('ma.setup.sub')}
      </Text>
      <View style={{ alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl }}>
        <Avatar name={me.displayName} size={96} contentUrl={me.avatarUrl} />
        <Button variant="secondary" label={me.avatarUrl ? t('profile.photo.change') : t('ma.setup.addPhoto')} loading={photoBusy} onPress={pickPhoto} />
      </View>
      <FormError message={error} />
      <TextField label={t('field.handle')} hint={t('ma.setup.handleHint')} value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={30} error={handleError} />
      <Button label={t('ma.setup.continue')} onPress={save} loading={busy} />
      <Button variant="ghost" label={t('ma.onb.skip')} onPress={next} style={{ marginTop: spacing.sm }} />
    </Screen>
  );
}
