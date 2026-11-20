import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { grantRole } from '../../../admin/ops2-api';
import { alertConfirm } from '../../../lib/confirm';
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
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = me?.roles.includes('admin') ?? false;

  const users = useQuery({ queryKey: admk.users(q, ''), queryFn: () => fetchAdminUsers(q, ''), enabled: isAdmin && tab === 'users' });
  const orgs = useQuery({ queryKey: admk.orgs(q, ''), queryFn: () => fetchAdminOrgs(q, ''), enabled: isAdmin && tab === 'orgs' });
  const query = tab === 'users' ? users : orgs;

  const run = useMutation({
    mutationFn: (v: { id: string; action: GovAction; reason: string }): Promise<{ approvalId?: string } | void> => {
      if (tab === 'users') return setUserStatus(v.id, { status: v.action === 'suspend' ? 'suspended' : 'active', reason: v.reason });
      if (v.action === 'verify') return setOrgVerification(v.id, { status: 'verified', reason: v.reason });
      if (v.action === 'unverify') return setOrgVerification(v.id, { status: 'unverified', reason: v.reason });
      return setOrgStatus(v.id, { status: v.action === 'suspend' ? 'suspended' : 'active', reason: v.reason });
    },
    onSuccess: (data) => {
      setOpen(null);
      setReason('');
      setError(null);
      // 202 : la demande attend la validation d'un second administrateur, rien n'est encore appliqué.
      setNotice(data && typeof data === 'object' && 'approvalId' in data && data.approvalId ? t('adm.flags.awaitingApproval') : null);
      void qc.invalidateQueries({ queryKey: admk.all });
    },
    onError: (e) => {
      // 409 : `details.reason` donne la cause précise (soi-même, administrateur, inchangé...).
      const why = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      const key = `admin.err.${why}` as MessageKey;
      setError(why && t(key) !== key ? t(key) : errorMessage(e, t, locale));
    },
  });

  // « Donner un rôle » : 204, ou 202 quand la double validation est active (rien n'est appliqué avant la validation d'un second administrateur).
  const router = useRouter();
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [role, setRole] = useState<'moderator' | 'support' | 'admin'>('moderator');
  const [roleReason, setRoleReason] = useState('');
  const grant = useMutation({
    mutationFn: (id: string) => grantRole(id, role, roleReason.trim()),
    onSuccess: (data) => {
      setRoleFor(null);
      setRoleReason('');
      setError(null);
      setNotice(data && 'approvalId' in data && data.approvalId ? t('adm.flags.awaitingApproval') : t('ops2.role.done'));
      void qc.invalidateQueries({ queryKey: admk.all });
    },
    onError: (e) => {
      const why = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      const key = `adm.err.${why}` as MessageKey;
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
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
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
            {tab === 'users' && open?.id !== r.id ? (
              roleFor === r.id ? (
                <>
                  <Text variant="bodyStrong">{t('ops2.role.title')}</Text>
                  <Chips<'moderator' | 'support' | 'admin'> value={role} onChange={setRole} options={(['moderator', 'support', 'admin'] as const).map((k) => ({ value: k, label: t(`ops2.role.${k}` as MessageKey) }))} />
                  <TextField label={t('admin.reason')} value={roleReason} onChangeText={setRoleReason} multiline maxLength={300} />
                  {error ? <Text variant="small" color="#B91C1C" accessibilityLiveRegion="polite">{error}</Text> : null}
                  <Button
                    label={t('ops2.role.give')}
                    loading={grant.isPending}
                    disabled={roleReason.trim().length < 3}
                    onPress={() => alertConfirm(t('admin.title'), t('ops2.role.confirm', { role: t(`ops2.role.${role}` as MessageKey), name: r.name }), [{ text: t('admin.cancel'), style: 'cancel' }, { text: t('ops2.role.give'), onPress: () => grant.mutate(r.id) }])}
                  />
                  <Button variant="ghost" label={t('admin.cancel')} onPress={() => { setRoleFor(null); setError(null); }} />
                </>
              ) : (
                <View style={styles.badges}>
                  <Button variant="ghost" label={t('ops2.sanctions.new')} onPress={() => router.push({ pathname: '/admin/sanctions', params: { userId: r.id } } as never)} />
                  <Button variant="ghost" label={t('ops2.role.give')} onPress={() => { setRoleFor(r.id); setRoleReason(''); setError(null); }} />
                </View>
              )
            ) : null}
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
