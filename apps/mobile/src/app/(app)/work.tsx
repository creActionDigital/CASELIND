import type { LeaveKind, LeaveRequest } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cancelLeave, fetchMyLeaves, fetchMySalary, fetchMyShifts, hrKeys, requestLeave } from '../../business/hr/api';
import { businessErrorMessage } from '../../business/hr/errors';
import { buildLeave, previewLeaveDays, shiftsByDay, weekDays, weekStart } from '../../business/hr/logic';
import { useI18n, type MessageKey } from '../../i18n';
import { alertConfirm } from '../../lib/confirm';
import { useMyOrgs } from '../../seller/api';
import { formatMinor } from '../../seller/money';
import { Card, Chips, Loading, SectionTitle } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../ui';

const KINDS: LeaveKind[] = ['annual', 'sick', 'unpaid', 'maternity', 'other'];

/** « Mon travail » : mes congés (demander, annuler), mon planning de la semaine et mes lignes de salaire, par organisation. */
export default function MyWork() {
  const orgs = useMyOrgs();
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const title = <Stack.Screen options={{ title: t('work.title') }} />;
  if (orgs.isPending) return <>{title}<Loading /></>;
  if (orgs.isError) return <>{title}<ErrorState error={orgs.error} onRetry={() => orgs.refetch()} /></>;
  const active = orgs.data.items.filter((m) => m.status === 'active');
  if (active.length === 0) return <>{title}<EmptyState icon="briefcase-outline" title={t('work.title')} body={t('work.empty')} /></>;
  const orgId = picked ?? active[0]!.org.id;
  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          {active.length > 1 ? <Chips options={active.map((m) => ({ value: m.org.id, label: m.org.name }))} value={orgId} onChange={setPicked} /> : null}
          <WorkOrg key={orgId} orgId={orgId} />
        </View>
      </Screen>
    </>
  );
}

function WorkOrg({ orgId }: { orgId: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const start = weekStart(new Date().toISOString().slice(0, 10));
  const days = weekDays(start);
  const leaves = useQuery({ queryKey: hrKeys.myLeaves(orgId), queryFn: () => fetchMyLeaves(orgId) });
  const shifts = useQuery({ queryKey: hrKeys.myShifts(orgId, start, days[6]!), queryFn: () => fetchMyShifts(orgId, start, days[6]!) });
  const salary = useQuery({ queryKey: hrKeys.mySalary(orgId), queryFn: () => fetchMySalary(orgId) });
  const [kind, setKind] = useState<LeaveKind>('annual');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: hrKeys.myLeaves(orgId) });
  const send = useMutation({
    mutationFn: () => {
      const built = buildLeave({ kind, startsOn: startsOn.trim(), endsOn: endsOn.trim(), reason });
      if ('error' in built) throw new Error(built.error);
      return requestLeave(orgId, built.ok);
    },
    onSuccess: () => { setInfo(null); setStartsOn(''); setEndsOn(''); setReason(''); refresh(); },
    onError: (e) => setInfo(/^(startsOn|endsOn|endBeforeStart|tooLong)$/.test((e as Error).message) ? t(`hr.err.${(e as Error).message}` as MessageKey) : businessErrorMessage(e, t, locale)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => cancelLeave(orgId, id), onSuccess: refresh, onError: (e) => setInfo(businessErrorMessage(e, t, locale)) });
  const confirmCancel = (l: LeaveRequest) =>
    alertConfirm(t('work.cancelConfirm'), `${l.startsOn} -> ${l.endsOn}`, [
      { text: t('hr.cancel'), style: 'cancel' },
      { text: t('work.cancelLeave'), style: 'destructive', onPress: () => cancel.mutate(l.id) },
    ]);

  if (leaves.isPending || shifts.isPending || salary.isPending) return <Loading />;
  if (leaves.isError) return <ErrorState error={leaves.error} onRetry={() => leaves.refetch()} />;
  if (shifts.isError) return <ErrorState error={shifts.error} onRetry={() => shifts.refetch()} />;
  if (salary.isError) return <ErrorState error={salary.error} onRetry={() => salary.refetch()} />;
  const b = leaves.data.balance;
  const preview = previewLeaveDays({ startsOn: startsOn.trim(), endsOn: endsOn.trim() });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={{ gap: spacing.md }}>
      <SectionTitle>{t('work.leaves')}</SectionTitle>
      <Text variant="small" muted>
        {b.annualQuotaDays === null
          ? t('work.balanceNoQuota', { year: b.year, used: b.annualUsedDays, pending: b.annualPendingDays })
          : t('work.balance', { year: b.year, used: b.annualUsedDays, pending: b.annualPendingDays, remaining: b.annualRemainingDays ?? 0, quota: b.annualQuotaDays })}
      </Text>
      <Chips options={KINDS.map((k) => ({ value: k, label: t(`hr.leave.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} />
      <TextField label={t('hr.f.startedOn')} value={startsOn} onChangeText={setStartsOn} autoCapitalize="none" />
      <TextField label={t('work.fieldEnd')} value={endsOn} onChangeText={setEndsOn} autoCapitalize="none" />
      <TextField label={t('work.fieldReason')} value={reason} onChangeText={setReason} multiline maxLength={300} />
      {preview !== null ? <Text variant="small" muted>{t('hr.leave.days', { n: preview })}</Text> : null}
      {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
      <Button label={t('work.send')} loading={send.isPending} onPress={() => { setInfo(null); send.mutate(); }} />
      {leaves.data.items.length === 0 ? <Text muted>{t('work.noLeaves')}</Text> : null}
      {leaves.data.items.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{t(`hr.leave.kind.${l.kind}` as MessageKey)}</Text>
            <Badge tone={l.status === 'approved' ? 'primary' : l.status === 'requested' ? 'accent' : 'neutral'} label={t(`hr.leave.status.${l.status}` as MessageKey)} />
          </View>
          <Text variant="small">{l.startsOn} {'->'} {l.endsOn} · {t('hr.leave.days', { n: l.days })}</Text>
          {l.decisionNote ? <Text variant="small" muted>{l.decisionNote}</Text> : null}
          {l.status === 'requested' || (l.status === 'approved' && l.startsOn > today) ? <Button variant="ghost" label={t('work.cancelLeave')} onPress={() => confirmCancel(l)} /> : null}
        </Card>
      ))}

      <SectionTitle>{t('work.shifts')}</SectionTitle>
      {shifts.data.items.length === 0 ? <Text muted>{t('work.noShifts')}</Text> : null}
      {shiftsByDay(shifts.data.items, days).filter((d) => d.items.length > 0).map((d) => (
        <Card key={d.date}>
          <Text variant="bodyStrong">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</Text>
          {d.items.map((s) => <Text key={s.id} variant="small">{s.startsAt}-{s.endsAt}{s.note ? ` · ${s.note}` : ''}</Text>)}
        </Card>
      ))}

      <SectionTitle>{t('work.salary')}</SectionTitle>
      {salary.data.items.length === 0 ? <Text muted>{t('work.noSalary')}</Text> : null}
      {salary.data.items.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{l.period.slice(0, 7)}</Text>
            <Text variant="bodyStrong">{formatMinor(l.grossMinor, l.currency, locale)}</Text>
          </View>
          {l.note ? <Text variant="small" muted>{l.note}</Text> : null}
        </Card>
      ))}
    </View>
  );
}
