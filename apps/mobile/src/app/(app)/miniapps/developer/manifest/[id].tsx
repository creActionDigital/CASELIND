import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { errorMessage } from '../../../../../lib/errors';
import { devKeys, fetchMyApps } from '../../../../../miniapps/developer/api';
import { isSemver, suggestNextVersion } from '../../../../../miniapps/developer/logic';
import { checkManifestText, manifestTemplate } from '../../../../../miniapps/manifest-logic';
import { createVersionWithManifest, saveDraftManifest } from '../../../../../miniapps/platform-api';
import { Card, Loading } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/**
 * Manifeste déclaratif (cahier §23) : données consultées, endpoints, événements, coûts, conditions. Brouillon ou refusée : on
 * l'enregistre sur l'application ; publiée : toute modification est une nouvelle version (nouvelle revue, nouveau consentement si besoin).
 */
export default function DeveloperManifest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: devKeys.apps, queryFn: fetchMyApps });
  const app = apps.data?.items.find((a) => a.id === id);
  const [text, setText] = useState('');
  const [version, setVersion] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (app && text === '') setText(JSON.stringify(app.manifest ?? manifestTemplate(app.scopes), null, 2));
  }, [app, text]);

  const done = () => {
    setSaved(true);
    void qc.invalidateQueries({ queryKey: devKeys.apps });
    void qc.invalidateQueries({ queryKey: devKeys.versions(id) });
  };
  const draftSave = useMutation({ mutationFn: (m: unknown) => saveDraftManifest(app!.orgId, app!.id, m), onSuccess: done });
  const versionSave = useMutation({ mutationFn: (m: unknown) => createVersionWithManifest(app!.id, { version: version.trim(), manifest: m, scopes: app!.scopes }), onSuccess: done });

  if (apps.isPending) return <Loading />;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;
  if (!app) return <Screen><Text muted>{t('miniapps.dev.empty')}</Text></Screen>;

  const live = app.status !== 'draft' && app.status !== 'rejected';
  const submit = () => {
    setSaved(false);
    const r = checkManifestText(text, app.scopes);
    if (!r.ok) return setProblems(r.problems);
    if (live && !isSemver(version)) return setProblems([t('miniapps.dev.err.semver')]);
    setProblems([]);
    (live ? versionSave : draftSave).mutate(r.manifest);
  };
  const error = draftSave.error ?? versionSave.error;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mp.dev.manifest.title') }} />
      <View style={{ gap: spacing.md }}>
        <Text variant="small" muted>{t(live ? 'mp.dev.manifest.hintLive' : 'mp.dev.manifest.hint')}</Text>
        <TextField label={t('mp.dev.manifest.field')} value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false} />
        {live ? <TextField label={t('miniapps.dev.versions.fieldVersion')} value={version} onChangeText={setVersion} placeholder={suggestNextVersion(app.currentVersion ? [app.currentVersion] : [])} autoCapitalize="none" /> : null}
        {problems.length > 0 ? (
          <Card>
            <Text variant="bodyStrong" color="#B3261E">{t('mp.dev.manifest.invalid', { n: problems.length })}</Text>
            {problems.map((p) => <Text key={p} variant="caption">• {p}</Text>)}
          </Card>
        ) : null}
        {error ? <Text variant="small" color="#B3261E">{errorMessage(error, t, locale)}</Text> : null}
        {saved ? <Text variant="small">{t(live ? 'mp.dev.manifest.savedVersion' : 'mp.dev.manifest.saved')}</Text> : null}
        <Button label={t(live ? 'mp.dev.manifest.saveVersion' : 'mp.dev.manifest.save')} loading={draftSave.isPending || versionSave.isPending} onPress={submit} />
      </View>
    </Screen>
  );
}
