import { meSchema } from '@caselind/contracts';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, useAuth } from '../../auth/auth-context';
import { FormError } from '../../auth/FormError';
import { useI18n } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';
import { Avatar, Button, Screen, Text, TextField } from '../../ui';

/** MyProfile : GET/PATCH /v1/me. Les données viennent du contexte d'auth (chargées par GET /me). */
export default function Profile() {
  const { t, locale } = useI18n();
  const { me, setMe } = useAuth();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [error, setError] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => setSaved(false), [displayName, handle, bio]);
  if (!me) return null;

  async function save() {
    setError(null);
    setHandleError(null);
    if (!displayName.trim()) {
      setError(t('field.required'));
      return;
    }
    setLoading(true);
    try {
      const updated = await api.request('/me', {
        method: 'PATCH',
        body: { displayName: displayName.trim(), handle: handle.trim(), bio: bio.trim() ? bio.trim() : null },
        schema: meSchema,
      });
      setMe(updated);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'conflict') setHandleError(t('profile.handleTaken'));
      else setError(errorMessage(e, t, locale));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <View style={{ alignItems: 'center', marginBottom: spacing.xl, gap: spacing.sm }}>
        <Avatar name={me.displayName} size={80} />
        <Text variant="small" muted>
          {t('profile.email')} : {me.email ?? t('profile.none')}
        </Text>
        <Text variant="small" muted>
          {t('profile.phone')} : {me.phone ?? t('profile.none')}
        </Text>
      </View>
      <FormError message={error} />
      <TextField label={t('field.displayName')} value={displayName} onChangeText={setDisplayName} maxLength={80} />
      <TextField
        label={t('field.handle')}
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoCorrect={false}
        error={handleError}
        maxLength={30}
      />
      <TextField label={t('field.bio')} value={bio} onChangeText={setBio} multiline maxLength={300} />
      <Button label={t('common.save')} onPress={save} loading={loading} />
      {saved ? (
        <Text variant="small" accessibilityLiveRegion="polite" style={{ marginTop: spacing.md, textAlign: 'center' }}>
          {t('common.saved')}
        </Text>
      ) : null}
    </Screen>
  );
}
