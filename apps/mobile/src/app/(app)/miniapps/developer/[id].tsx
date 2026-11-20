import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BarChart } from '../../../../admin-ops/BarChart';
import { CertBadge } from '../../../../miniapps/ManifestSummary';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { alertConfirm } from '../../../../lib/confirm';
import { errorMessage } from '../../../../lib/errors';
import {
  createVersion,
  devKeys,
  fetchMyApps,
  fetchStats,
  fetchVersions,
  rotateSecret,
  submitApp,
  submitVersion,
} from '../../../../miniapps/developer/api';
import { addedScopes, errorRatePercent, isSemver, suggestNextVersion, usagePoints } from '../../../../miniapps/developer/logic';
import { takeSecret } from '../../../../miniapps/developer/secret-store';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

type Days = 7 | 30 | 90;

/** Détail d'une application : statut, secret (affiché une seule fois), versions, statistiques et quota. */
export default function DeveloperApp() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const apps = useQuery({ queryKey: devKeys.apps, queryFn: fetchMyApps });
  const { colors } = useTheme();
  const app = apps.data?.items.find((a) => a.id === id);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Secret montré à la création : lu une fois dans la mémoire du processus.
  useEffect(() => {
    if (id) setSecret(takeSecret(id));
  }, [id]);

  const fail = (e: unknown) => {
    const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
    setError(reason === 'version_exists' ? t('miniapps.dev.err.exists') : reason === 'app_locked' || reason === 'app_suspended' || reason === 'invalid_transition' ? t('miniapps.dev.err.locked') : errorMessage(e, t, locale));
  };
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: devKeys.apps });
  };

  const submit = useMutation({ mutationFn: () => submitApp(app!.orgId, app!.id), onSuccess: refresh, onError: fail });
  const rotate = useMutation({
    mutationFn: () => rotateSecret(app!.orgId, app!.id),
    onSuccess: (r) => {
      setSecret(r.clientSecret);
      refresh();
    },
    onError: fail,
  });

  if (apps.isPending) return <Loading />;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;
  if (!app) return <Screen><Text muted>{t('miniapps.dev.empty')}</Text></Screen>;

  const askRotate = () =>
    alertConfirm(t('miniapps.dev.secret.confirmTitle'), t('miniapps.dev.secret.confirmBody'), [
      { text: t('miniapps.pay.cancel'), style: 'cancel' },
      { text: t('miniapps.dev.secret.rotate'), style: 'destructive', onPress: () => rotate.mutate() },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: app.name }} />
      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="bodyStrong">{app.name}</Text>
          <Badge tone={app.status === 'published' ? 'accent' : 'neutral'} label={t(`miniapps.dev.status.${app.status}` as MessageKey)} />
          <Text variant="small" muted>{app.currentVersion ? t('miniapps.dev.version', { version: app.currentVersion }) : t('miniapps.dev.noVersion')}</Text>
          <Text variant="caption" muted>{t('miniapps.dev.clientId')}</Text>
          <Text variant="small" selectable>{app.clientId}</Text>
          {app.reviewNote ? <Text variant="small">{t('miniapps.dev.reviewNote', { note: app.reviewNote })}</Text> : null}
          {app.status === 'draft' || app.status === 'rejected' ? (
            <Button label={t('miniapps.dev.submit')} loading={submit.isPending} onPress={() => submit.mutate()} />
          ) : null}
        </Card>

        <SectionTitle>{t('miniapps.dev.secret.title')}</SectionTitle>
        <Card>
          {secret ? (
            <>
              <Text variant="small" selectable style={{ fontWeight: '600' }}>{secret}</Text>
              <Text variant="caption" muted>{t('miniapps.dev.secret.once')}</Text>
              <Button variant="secondary" label={t('miniapps.dev.secret.done')} onPress={() => setSecret(null)} />
            </>
          ) : app.confidential ? (
            <Button variant="secondary" label={t('miniapps.dev.secret.rotate')} loading={rotate.isPending} onPress={askRotate} />
          ) : (
            <Text variant="small" muted>{t('miniapps.dev.secret.public')}</Text>
          )}
        </Card>
        {error ? <Text variant="small" color={colors.danger}>{error}</Text> : null}

        <Card>
          <Button variant="secondary" label={t('mp.dev.manifest.open')} onPress={() => router.push(`/miniapps/developer/manifest/${app.id}` as never)} />
          <Button variant="secondary" label={t('mp.dev.hook.open')} onPress={() => router.push(`/miniapps/developer/webhook/${app.id}` as never)} />
          <Button variant="secondary" label={t('mp.dev.revenue.open')} onPress={() => router.push(`/miniapps/developer/revenue/${app.id}` as never)} />
          <CertBadge level={app.certification} />
        </Card>

        <Versions appId={app.id} scopes={app.scopes} onError={fail} />
        <Stats appId={app.id} />
      </View>
    </Screen>
  );
}

function Versions({ appId, scopes, onError }: { appId: string; scopes: readonly string[]; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: devKeys.versions(appId), queryFn: () => fetchVersions(appId) });
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: devKeys.versions(appId) });
  const create = useMutation({
    mutationFn: () => createVersion(appId, { version: version.trim(), changelog: changelog.trim() || null }),
    onSuccess: () => {
      setVersion('');
      setChangelog('');
      done();
    },
    onError,
  });
  const submit = useMutation({ mutationFn: (vid: string) => submitVersion(appId, vid), onSuccess: done, onError });
  const suggestion = suggestNextVersion(q.data?.items.map((v) => v.version) ?? []);
  return (
    <>
      <SectionTitle>{t('miniapps.dev.versions')}</SectionTitle>
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 ? <Text muted>{t('miniapps.dev.versions.empty')}</Text> : null}
      {q.data?.items.map((v) => {
        const added = addedScopes(scopes, v.scopes);
        return (
          <Card key={v.id}>
            <Text variant="bodyStrong">{v.version}</Text>
            <Badge tone={v.status === 'approved' ? 'accent' : 'neutral'} label={t(`miniapps.dev.versionStatus.${v.status}` as MessageKey)} />
            {v.changelog ? <Text variant="small">{v.changelog}</Text> : null}
            {v.status === 'draft' && added.length > 0 ? (
              <Text variant="caption" muted>{t('miniapps.dev.versions.added', { scopes: added.map((s) => t(`miniapps.scope.${s}` as MessageKey)).join(', ') })}</Text>
            ) : null}
            {v.reviewNote ? <Text variant="small">{t('miniapps.dev.reviewNote', { note: v.reviewNote })}</Text> : null}
            {v.status === 'draft' ? <Button variant="secondary" label={t('miniapps.dev.versions.submit')} loading={submit.isPending} onPress={() => submit.mutate(v.id)} /> : null}
          </Card>
        );
      })}
      <Card>
        <Text variant="bodyStrong">{t('miniapps.dev.versions.new')}</Text>
        <TextField label={t('miniapps.dev.versions.fieldVersion')} value={version} onChangeText={setVersion} placeholder={suggestion} autoCapitalize="none" autoCorrect={false} error={formError} />
        <TextField label={t('miniapps.dev.versions.fieldChangelog')} value={changelog} onChangeText={setChangelog} multiline maxLength={1000} />
        <Button
          label={t('miniapps.dev.versions.create')}
          loading={create.isPending}
          onPress={() => {
            if (!isSemver(version)) return setFormError(t('miniapps.dev.err.semver'));
            setFormError(null);
            create.mutate();
          }}
        />
      </Card>
    </>
  );
}

function Stats({ appId }: { appId: string }) {
  const { t } = useI18n();
  const [days, setDays] = useState<Days>(30);
  const q = useQuery({ queryKey: devKeys.stats(appId, days), queryFn: () => fetchStats(appId, days) });
  return (
    <>
      <SectionTitle>{t('miniapps.dev.stats')}</SectionTitle>
      <Chips<string>
        value={String(days)}
        onChange={(v) => setDays(Number(v) as Days)}
        options={[7, 30, 90].map((d) => ({ value: String(d), label: t('miniapps.dev.stats.days', { days: d }) }))}
      />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <Card>
          <BarChart title={t('miniapps.dev.stats.calls')} points={usagePoints(q.data.items, 'apiCalls')} />
          <BarChart title={t('miniapps.dev.stats.authorizations')} points={usagePoints(q.data.items, 'authorizations')} />
          <Text variant="small">{t('miniapps.dev.stats.activeUsers', { n: q.data.items.at(-1)?.activeUsers ?? 0 })}</Text>
          <Text variant="small">{t('miniapps.dev.stats.payments', { requests: q.data.totals.paymentRequests, confirmed: q.data.totals.paymentsConfirmed })}</Text>
          <Text variant="small">{t('miniapps.dev.stats.errors', { errors: q.data.totals.errors, rate: errorRatePercent(q.data.totals.errors, q.data.totals.apiCalls) })}</Text>
          <Text variant="bodyStrong">{t('miniapps.dev.quota')}</Text>
          <Text variant="small">{t('miniapps.dev.quota.line', { perMinute: q.data.quota.perMinute, perDay: q.data.quota.perDay })}</Text>
          {q.data.quota.overridden ? <Text variant="caption" muted>{t('miniapps.dev.quota.overridden')}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}
