import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { errorMessage } from '../../../lib/errors';
import { deniedRedirect, manifestOf, parseConsentParams } from '../../../miniapps/consent-logic';
import { CertBadge, ManifestSummary } from '../../../miniapps/ManifestSummary';
import { authorizeApp, fetchConsentPreview, pKeys } from '../../../miniapps/platform-api';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/**
 * Écran de consentement natif OAuth, ouvert par `caselind://miniapps/consent?client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256`.
 * Il montre ce que l'application déclare (manifeste approuvé), puis Autoriser (code livré à l'adresse enregistrée) ou Refuser (access_denied).
 * Le retour vers l'application n'a lieu qu'après validation de `redirect_uri` par le serveur (correspondance exacte) : aucune redirection ouverte.
 * Le même écran sert au nouveau consentement (version qui ajoute des accès, des données ou des coûts).
 */
export default function MiniAppConsent() {
  const raw = useLocalSearchParams<Record<string, string | string[]>>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const parsed = useMemo(() => parseConsentParams(raw), [raw]);
  const [done, setDone] = useState<'allowed' | 'denied' | null>(null);
  const p = parsed.ok ? parsed.value : null;

  const preview = useQuery({
    queryKey: pKeys.preview(p?.clientId ?? '', p?.redirectUri ?? '', p?.scopes.join(' ') ?? ''),
    queryFn: () => fetchConsentPreview(p!.clientId, p!.redirectUri, p!.scopes),
    enabled: !!p,
    retry: false,
  });

  const allow = useMutation({
    mutationFn: () => authorizeApp({ clientId: p!.clientId, redirectUri: p!.redirectUri, scopes: p!.scopes, state: p!.state, codeChallenge: p!.codeChallenge }),
    onSuccess: (r) => {
      setDone('allowed');
      void Linking.openURL(r.redirectTo);
    },
  });

  if (!p) return <Screen><Stack.Screen options={{ title: t('mp.consent.title') }} /><Text>{t('mp.consent.invalid')}</Text></Screen>;
  if (preview.isPending) return <><Stack.Screen options={{ title: t('mp.consent.title') }} /><Loading /></>;
  if (preview.isError) return <Screen><Stack.Screen options={{ title: t('mp.consent.title') }} /><Text>{t('mp.consent.invalid')}</Text><ErrorState error={preview.error} onRetry={() => preview.refetch()} /></Screen>;

  const { app, scopes, certification, manifest, reconsentRequired } = preview.data;
  const hasManifest = manifestOf(manifest) !== null;

  const askAllow = () =>
    alertConfirm(t('mp.consent.confirmTitle'), t('mp.consent.confirmBody', { name: app.name }), [
      { text: t('miniapps.pay.cancel'), style: 'cancel' },
      { text: t('mp.consent.allow'), onPress: () => allow.mutate() },
    ]);
  const askDeny = () =>
    alertConfirm(t('mp.consent.denyTitle'), t('mp.consent.denyBody', { name: app.name }), [
      { text: t('miniapps.pay.cancel'), style: 'cancel' },
      {
        text: t('mp.consent.deny'),
        style: 'destructive',
        onPress: () => {
          setDone('denied');
          void Linking.openURL(deniedRedirect(p.redirectUri, p.state));
        },
      },
    ]);

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ title: app.name }} />
        <Text variant="bodyStrong">{t(done === 'allowed' ? 'mp.consent.allowed' : 'mp.consent.denied', { name: app.name })}</Text>
        <Button variant="secondary" label={t('mp.consent.close')} onPress={() => router.replace('/miniapps' as never)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mp.consent.title') }} />
      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="bodyStrong">{app.name}</Text>
          <Text variant="small" muted>{t('miniapps.by', { name: app.organization.name })}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <CertBadge level={certification} />
            {app.organization.verified ? <Badge tone="accent" label={t('miniapps.verified')} /> : null}
          </View>
          {app.description ? <Text>{app.description}</Text> : null}
        </Card>
        {reconsentRequired ? <Card><Text variant="small">{t('mp.consent.reconsent')}</Text></Card> : null}
        <Card>
          <Text variant="bodyStrong">{t('mp.consent.scopes', { name: app.name })}</Text>
          {scopes.map((s) => (
            <Text key={s.scope} variant="small">• {t(`miniapps.scope.${s.scope}` as MessageKey)}{s.alreadyGranted ? ` (${t('mp.consent.already')})` : ''}</Text>
          ))}
        </Card>
        <Card><ManifestSummary manifest={manifest} /></Card>
        {allow.isError ? <Text variant="small" color="#B3261E">{errorMessage(allow.error, t, locale)}</Text> : null}
        {hasManifest ? (
          <>
            <Button label={t('mp.consent.allow')} loading={allow.isPending} onPress={askAllow} />
            <Button variant="secondary" label={t('mp.consent.deny')} onPress={askDeny} />
          </>
        ) : (
          <>
            <Text variant="small" color="#B3261E">{t('mp.consent.noManifest')}</Text>
            <Button variant="secondary" label={t('mp.consent.deny')} onPress={askDeny} />
          </>
        )}
      </View>
    </Screen>
  );
}
