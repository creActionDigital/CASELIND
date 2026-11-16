import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { admk, fetchAdminOrgs, fetchAdminUsers, setOrgStatus, setOrgVerification, setUserStatus } from '../../../admin/api';
import { isValidReason, orgActions, userActions, type GovAction } from '../../../admin/logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Card, Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';

type Tab = 'users' | 'orgs';
type Row = { id: string; name: string; lines: string[]; status: string; badges: string[]; actions: GovAction[] };

/** Gouvernance : suspension des comptes et des organisations, vérification des organisations. Motif obligatoire, action auditée. */
export default function Governance() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('users');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ id: string; action: GovAction } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me?.roles.includes('admin') ?? false;

  const users = useQuery({ queryKey: admk.users(q, ''), queryFn: () => fetchAdminUsers(q, ''), enabled: isAdmin && tab === 'users' });
  const orgs = useQuery({ queryKey: admk.orgs(q, ''), queryFn: () => fetchAdminOrgs(q, ''), enabled: isAdmin && tab === 'orgs' });
  const query = tab === 'users' ? users : orgs;

  const run = useMutation({
    mutationFn: (v: { id: string; action: GovAction; reason: string }) => {
      if (tab === 'users') return setUserStatus(v.id, { status: v.action === 'suspend' ? 'suspended' : 'active', reason: v.reason });
      if (v.action === 'verify') return setOrgVerification(v.id, { status: 'verified', reason: v.reason });
      if (v.action === 'unverify') return setOrgVerification(v.id, { status: 'unverified', reason: v.reason });
      return setOrgStatus(v.id, { status: v.action === 'suspend' ? 'suspended' : 'active', reason: v.reason });
    },
    onSuccess: () => { setOpen(null); setReason(''); setError(null); void qc.invalidateQueries({ queryKey: admk.all }); },
    onError: (e) => {
      // 409 : `details.reason` donne la cause précise (soi-même, administrateur, inchangé...).
      const why = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      const key = `admin.err.${why}` as MessageKey;
      setError(why && t(key) !== key ? t(key) : errorMessage(e, t, locale));
    },
  });

  const confirm = (name: string) => {
    if (!open) return;
    const vars = { ...open, reason: reason.trim() };
    const msg = t('admin.confirmMsg', { action: t(`admin.action.${open.action}` as MessageKey), name });
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (globalThis.confirm?.(msg)) run.mutate(vars);
      return;
    }
    Alert.alert(t('admin.title'), msg, [{ text: t('admin.cancel'), style: 'cancel' }, { text: t('admin.action.' + open.action as MessageKey), onPress: () => run.mutate(vars) }]);
  };

  if (!isAdmin) return <EmptyState icon="lock-closed-outline" title={t('admin.forbidden')} />;

  const rows: Row[] =
    tab === 'users'
      ? (users.data?.items ?? []).map((u) => ({ id: u.id, name: u.displayName, lines: [`@${u.handle}`, u.roles.join(', ')], status: u.status, badges: [], actions: userActions(u.status) }))
      : (orgs.data?.items ?? []).map((o) => ({ id: o.id, name: o.name, lines: [`${o.slug} · ${o.kind}`], status: o.status, badges: [o.verificationStatus], actions: orgActions(o.status, o.verificationStatus) }));
  const label = (k: string) => { const key = k as MessageKey; const s = t(key); return s === k ? k : s; };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('admin.title') }} />
      <Chips<Tab>
        value={tab}
        onChange={(v) => { setTab(v); setOpen(null); setError(null); }}
        options={[{ value: 'users', label: t('admin.tab.users') }, { value: 'orgs', label: t('admin.tab.orgs') }]}
      />
      <TextField label={t('admin.search')} value={q} onChangeText={setQ} maxLength={60} autoCapitalize="none" />
      {query.isPending ? null : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="search-outline" title={t('admin.empty')} />
      ) : (
        rows.map((r) => (
          <Card key={r.id} style={styles.card}>
            <Text variant="bodyStrong">{r.name}</Text>
            {r.lines.filter(Boolean).map((l) => <Text key={l} variant="small" muted>{l}</Text>)}
            <View style={styles.badges}>
              <Badge tone={r.status === 'active' ? 'primary' : 'accent'} label={label(`admin.status.${r.status}`)} />
              {r.badges.map((b) => <Badge key={b} tone={b === 'verified' ? 'primary' : 'neutral'} label={label(`admin.verif.${b}`)} />)}
            </View>
            {open?.id === r.id ? (
              <>
                <TextField label={t('admin.reason')} value={reason} onChangeText={setReason} multiline maxLength={500} />
                {error ? <Text variant="small" color="#B91C1C" accessibilityLiveRegion="polite">{error}</Text> : null}
                <Button
                  variant={open.action === 'suspend' ? 'danger' : 'primary'}
                  label={t('admin.confirm', { action: t(`admin.action.${open.action}` as MessageKey) })}
                  loading={run.isPending}
                  disabled={!isValidReason(reason)}
                  onPress={() => confirm(r.name)}
                />
                <Button variant="ghost" label={t('admin.cancel')} onPress={() => { setOpen(null); setError(null); }} />
              </>
            ) : (
              <View style={styles.badges}>
                {r.actions.map((a) => (
                  <Button key={a} variant="secondary" label={t(`admin.action.${a}` as MessageKey)} onPress={() => { setOpen({ id: r.id, action: a }); setReason(''); setError(null); }} />
                ))}
              </View>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, marginBottom: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
