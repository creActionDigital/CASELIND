import type { MiniApp, MiniAppVersion } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, DecisionPanel, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { CertBadge, ManifestSummary } from '../../../miniapps/ManifestSummary';
import { certifyApp, decertifyApp, decideVersion, fetchPublishedApps, fetchReviewVersions, setAppQuota, setAppRevenueShare, suspendApp } from '../../../miniapps/platform-api';
import { Card, Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, Text, TextField } from '../../../ui';

type Mode = 'versions' | 'apps';
const STATUSES = ['submitted', 'approved', 'rejected'] as const;

function VersionCard({ v }: { v: MiniAppVersion }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (x: { d: 'approve' | 'reject'; note: string }) => decideVersion(v.id, x.d, x.note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{t('mp.adm.version', { version: v.version })}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={v.status === 'submitted' ? 'accent' : 'neutral'} label={t(`miniapps.dev.versionStatus.${v.status}` as MessageKey)} />
        {v.needsReconsent ? <Badge tone="primary" label={t('mp.adm.reconsent')} /> : null}
      </View>
      {v.changelog ? <Text variant="small">{v.changelog}</Text> : null}
      <Text variant="small" muted>{t('adm.apps.scopes', { list: v.scopes.join(', ') || '-' })}</Text>
      {v.addedScopes.length > 0 ? <Text variant="small">{t('mp.adm.added', { list: v.addedScopes.join(', ') })}</Text> : null}
      <Text variant="caption" muted>{when(v.submittedAt ?? v.createdAt, locale)}</Text>
      <ManifestSummary manifest={v.manifest} />
      {v.reviewNote ? <Text variant="small" muted>{t('adm.apps.note', { note: v.reviewNote })}</Text> : null}
      <DecisionPanel<'approve' | 'reject'>
        name={`${v.version}`}
        decisions={v.status === 'submitted' ? ['approve', 'reject'] : []}
        needsReason={(d) => d === 'reject'}
        fieldLabel="adm.apps.fieldNote"
        labelOf={(d) => t(`adm.decision.${d}` as MessageKey)}
        run={(d, note) => decide.mutateAsync({ d, note })}
      />
    </Card>
  );
}

/** Champ numérique + bouton (quota par minute, part de la plateforme en points de base). */
function NumberSetting({ label, initial, hint, save, clearable }: { label: string; initial: number | null; hint?: string; save: (n: number | null) => Promise<unknown>; clearable?: boolean }) {
  const { t, locale } = useI18n();
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [state, setState] = useState<{ busy: boolean; error: string | null; ok: boolean }>({ busy: false, error: null, ok: false });
  const n = value.trim() === '' ? null : Number(value);
  const valid = n === null ? !!clearable : Number.isInteger(n) && n >= 0;
  return (
    <View style={{ gap: spacing.xs }}>
      <TextField label={label} value={value} onChangeText={(v) => { setValue(v); setState({ busy: false, error: null, ok: false }); }} keyboardType="number-pad" hint={hint} error={state.error} />
      <Button
        variant="secondary"
        label={state.ok ? t('mp.adm.saved') : t('mp.adm.save')}
        disabled={!valid}
        loading={state.busy}
        onPress={() => {
          setState({ busy: true, error: null, ok: false });
          save(n).then(
            () => setState({ busy: false, error: null, ok: true }),
            (e: unknown) => setState({ busy: false, error: adminErrorMessage(e, t, locale), ok: false }),
          );
        }}
      />
    </View>
  );
}

type AppDecision = 'certify' | 'decertify' | 'suspend';

function AppCard({ a }: { a: MiniApp }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (x: { d: AppDecision; note: string }) => (x.d === 'certify' ? certifyApp(a.id, x.note) : x.d === 'decertify' ? decertifyApp(a.id) : suspendApp(a.id, x.note)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  const decisions: AppDecision[] = a.certification === 'certified' ? ['decertify', 'suspend'] : ['certify', 'suspend'];
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{a.name}</Text>
      <View style={adminStyles.badges}>
        <CertBadge level={a.certification} />
        {a.currentVersion ? <Badge tone="neutral" label={t('miniapps.dev.version', { version: a.currentVersion })} /> : null}
      </View>
      {a.certificationNote ? <Text variant="small" muted>{a.certificationNote}</Text> : null}
      {a.certifiedAt ? <Text variant="caption" muted>{t('mp.adm.certifiedAt', { date: when(a.certifiedAt, locale) })}</Text> : null}
      <NumberSetting label={t('mp.adm.quota')} hint={t('mp.adm.quotaHint')} initial={a.rateLimitPerMinute ?? null} clearable save={(n) => setAppQuota(a.id, n).then(() => qc.invalidateQueries({ queryKey: cck.all }))} />
      <NumberSetting label={t('mp.adm.share')} hint={t('mp.adm.shareHint')} initial={a.revenueShareBps ?? 0} save={(n) => setAppRevenueShare(a.id, n ?? 0)} />
      <DecisionPanel<AppDecision>
        name={a.name}
        decisions={decisions}
        needsReason={(d) => d !== 'decertify'}
        fieldLabel="mp.adm.fieldNote"
        labelOf={(d) => t(`mp.adm.decision.${d}` as MessageKey)}
        run={(d, note) => run.mutateAsync({ d, note })}
      />
    </Card>
  );
}

/** File de revue des versions (approuver ou rejeter avec motif) et réglages par application : quota, partage, certification, suspension. */
export default function MiniappVersionsAdmin() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const [mode, setMode] = useState<Mode>('versions');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('submitted');
  const versions = useCursorList(['miniapp-versions', status], (c) => fetchReviewVersions(status, c), allowed && mode === 'versions');
  const apps = useCursorList(['miniapp-published'], (c) => fetchPublishedApps(c), allowed && mode === 'apps');
  if (!allowed) return <Denied />;
  const header = (
    <View style={{ gap: spacing.xs }}>
      <Chips<Mode> value={mode} onChange={setMode} options={[{ value: 'versions', label: t('mp.adm.tabVersions') }, { value: 'apps', label: t('mp.adm.tabApps') }]} />
      {mode === 'versions' ? <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`miniapps.dev.versionStatus.${s}` as MessageKey) }))} /> : null}
    </View>
  );
  return mode === 'versions' ? (
    <AdminList<MiniAppVersion> title={t('mp.adm.title')} query={versions} keyExtractor={(v) => v.id} emptyTitle={t('adm.empty')} header={header} renderItem={({ item }) => <VersionCard v={item} />} />
  ) : (
    <AdminList<MiniApp> title={t('mp.adm.title')} query={apps} keyExtractor={(a) => a.id} emptyTitle={t('adm.empty')} header={header} renderItem={({ item }) => <AppCard a={item} />} />
  );
}
