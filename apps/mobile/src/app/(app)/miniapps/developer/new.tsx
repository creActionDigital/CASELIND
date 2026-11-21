import { MINIAPP_CATEGORIES, MINIAPP_SCOPES, type MiniAppCategory, type MiniAppScope } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { imageMime, uploadImage } from '../../../../media/upload';
import { createApp, devKeys } from '../../../../miniapps/developer/api';
import { parseRedirectUris, toggleScope, validateAppForm } from '../../../../miniapps/developer/logic';
import { holdSecret } from '../../../../miniapps/developer/secret-store';
import { useMyOrgs } from '../../../../seller/api';
import { Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Création d'une application : nom, description, icône (média « org_logo »), https partout, accès demandés. */
export default function NewMiniApp() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const orgs = useMyOrgs();
  const owned = (orgs.data?.items ?? []).filter((m) => m.status === 'active' && m.role === 'owner');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconId, setIconId] = useState<string | null>(null);
  const [category, setCategory] = useState<MiniAppCategory | ''>('');
  const [launchUrl, setLaunchUrl] = useState('https://');
  const [redirects, setRedirects] = useState('https://');
  const [scopes, setScopes] = useState<MiniAppScope[]>(['profile.basic']);
  const [confidential, setConfidential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createApp(orgId ?? owned[0]!.org.id, {
        name: name.trim(),
        description: description.trim() || null,
        iconMediaId: iconId,
        launchUrl: launchUrl.trim(),
        redirectUris: parseRedirectUris(redirects),
        scopes,
        confidential,
        category: category || null,
      }),
    onSuccess: (app) => {
      if (app.clientSecret) holdSecret(app.id, app.clientSecret);
      void qc.invalidateQueries({ queryKey: devKeys.apps });
      router.replace(`/miniapps/developer/${app.id}` as never);
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  async function pickIcon() {
    setError(null);
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (res.canceled) return;
      const a = res.assets[0]!;
      setIconId(await uploadImage(a.uri, imageMime(a.mimeType, a.uri), 'org_logo'));
    } catch (e) {
      setError(errorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const bad = validateAppForm({ name, launchUrl, redirectUris: redirects, scopes });
    if (bad) return setError(t(`miniapps.dev.err.${bad}` as MessageKey));
    setError(null);
    create.mutate();
  }

  if (orgs.isPending) return <Loading />;
  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => orgs.refetch()} />;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('miniapps.dev.new') }} />
      <View style={{ gap: spacing.md }}>
        {owned.length === 0 ? (
          <>
            <Text muted>{t('miniapps.dev.noOrg')}</Text>
            <Button label={t('miniapps.dev.createOrg')} onPress={() => router.push('/seller/new' as never)} />
          </>
        ) : null}
        {owned.length > 1 ? (
          <>
            <SectionTitle>{t('miniapps.dev.org')}</SectionTitle>
            <Chips value={orgId ?? owned[0]!.org.id} onChange={setOrgId} options={owned.map((m) => ({ value: m.org.id, label: m.org.name }))} />
          </>
        ) : null}
        <TextField label={t('miniapps.dev.new.name')} value={name} onChangeText={setName} maxLength={60} />
        <TextField label={t('miniapps.dev.new.description')} value={description} onChangeText={setDescription} multiline maxLength={500} />
        <Text variant="small" style={{ fontWeight: '600' }}>{t('md.apps.devCategory')}</Text>
        <Chips<MiniAppCategory | ''>
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: t('md.apps.catAll') }, ...MINIAPP_CATEGORIES.map((c) => ({ value: c, label: t(`md.apps.cat.${c}` as MessageKey) }))]}
        />
        <Button variant="secondary" label={iconId ? t('miniapps.dev.new.iconDone') : t('miniapps.dev.new.icon')} disabled={busy} onPress={pickIcon} />
        <TextField label={t('miniapps.dev.new.launchUrl')} value={launchUrl} onChangeText={setLaunchUrl} keyboardType="url" autoCapitalize="none" autoCorrect={false} />
        <TextField label={t('miniapps.dev.new.redirectUris')} value={redirects} onChangeText={setRedirects} multiline autoCapitalize="none" autoCorrect={false} />
        <SectionTitle>{t('miniapps.dev.new.scopes')}</SectionTitle>
        {MINIAPP_SCOPES.map((s) => (
          <Button key={s} variant={scopes.includes(s) ? 'primary' : 'secondary'} label={t(`miniapps.scope.${s}` as MessageKey)} onPress={() => setScopes(toggleScope(scopes, s))} />
        ))}
        <Button variant={confidential ? 'primary' : 'secondary'} label={t('miniapps.dev.new.confidential')} onPress={() => setConfidential(!confidential)} />
        {error ? <Text variant="small" color={colors.danger}>{error}</Text> : null}
        <Button label={t('miniapps.dev.new.create')} disabled={owned.length === 0 || busy} loading={create.isPending} onPress={submit} />
      </View>
    </Screen>
  );
}
