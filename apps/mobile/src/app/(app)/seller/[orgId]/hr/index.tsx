import type { Employee, EmploymentType } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { fetchEmployees, hrKeys, saveEmployee } from '../../../../../business/hr/api';
import { businessErrorMessage } from '../../../../../business/hr/errors';
import { isDate, parseQuota } from '../../../../../business/hr/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { useMembership } from '../../../../../seller/api';
import { canManageHr, canManagePayroll } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

const TYPES: EmploymentType[] = ['full_time', 'part_time', 'contract', 'intern'];

interface Form {
  jobTitle: string;
  department: string;
  employmentType: EmploymentType;
  startedOn: string;
  quota: string;
  note: string;
  managerUserId: string | null;
}

const formOf = (e: Employee): Form => ({
  jobTitle: e.profile?.jobTitle ?? '',
  department: e.profile?.department ?? '',
  employmentType: e.profile?.employmentType ?? 'full_time',
  startedOn: e.profile?.startedOn ?? new Date().toISOString().slice(0, 10),
  quota: e.profile?.annualLeaveDays == null ? '' : String(e.profile.annualLeaveDays),
  note: e.profile?.note ?? '',
  managerUserId: e.profile?.managerUserId ?? null,
});

/** « Ressources humaines » (permission `hr.manage`) : employés et fiches, accès aux congés, au planning et au registre de salaire. */
export default function HrHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = canManageHr(role);
  const list = useQuery({ queryKey: hrKeys.employees(orgId), queryFn: () => fetchEmployees(orgId), enabled: !!orgId && allowed });
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = useMutation({
    mutationFn: () => {
      if (!editing || !form) throw new Error('none');
      const quota = parseQuota(form.quota);
      if (!form.jobTitle.trim()) throw new Error('jobTitle');
      if (!isDate(form.startedOn)) throw new Error('startsOn');
      if (quota === undefined) throw new Error('quota');
      return saveEmployee(orgId, editing, {
        jobTitle: form.jobTitle.trim(),
        department: form.department.trim() || null,
        employmentType: form.employmentType,
        startedOn: form.startedOn,
        annualLeaveDays: quota,
        managerUserId: form.managerUserId,
        note: form.note.trim() || null,
      });
    },
    onSuccess: () => {
      setEditing(null);
      setForm(null);
      setInfo(null);
      void qc.invalidateQueries({ queryKey: hrKeys.employees(orgId) });
    },
    onError: (e) => setInfo(/^(jobTitle|startsOn|quota)$/.test((e as Error).message) ? t(`hr.err.${(e as Error).message}` as MessageKey) : businessErrorMessage(e, t, locale)),
  });

  const title = <Stack.Screen options={{ title: t('hr.title') }} />;
  if (isPending || (allowed && list.isPending)) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('hr.forbidden')}</Text></Screen></>;
  if (list.isError) return <>{title}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;

  const go = (p: string) => router.push(`/seller/${orgId}/hr/${p}` as never);
  const employees = list.data?.items ?? [];

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Button variant="secondary" label={t('hr.link.leave')} onPress={() => go('leave')} />
          <Button variant="secondary" label={t('hr.link.schedule')} onPress={() => go('schedule')} />
          {canManagePayroll(role) ? <Button variant="secondary" label={t('hr.link.salary')} onPress={() => go('salary')} /> : null}

          <SectionTitle>{t('hr.employees')}</SectionTitle>
          {employees.map((e) => (
            <Card key={e.userId}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{e.displayName}</Text>
                <Badge tone="neutral" label={e.role} />
              </View>
              <Text variant="small" muted>
                {e.profile ? [e.profile.jobTitle, e.profile.department, t(`hr.type.${e.profile.employmentType}` as MessageKey)].filter(Boolean).join(' · ') : t('hr.emp.noProfile')}
              </Text>
              {editing === e.userId && form ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  <TextField label={t('hr.f.jobTitle')} value={form.jobTitle} onChangeText={(v) => set({ jobTitle: v })} maxLength={80} />
                  <TextField label={t('hr.f.department')} value={form.department} onChangeText={(v) => set({ department: v })} maxLength={60} />
                  <Chips options={TYPES.map((k) => ({ value: k, label: t(`hr.type.${k}` as MessageKey) }))} value={form.employmentType} onChange={(employmentType) => set({ employmentType })} />
                  <TextField label={t('hr.f.startedOn')} value={form.startedOn} onChangeText={(v) => set({ startedOn: v })} autoCapitalize="none" />
                  <TextField label={t('hr.f.quota')} value={form.quota} onChangeText={(v) => set({ quota: v })} keyboardType="number-pad" />
                  <Text variant="small">{t('hr.f.manager')}</Text>
                  <Chips
                    options={[{ value: '', label: t('hr.f.noManager') }, ...employees.filter((m) => m.userId !== e.userId).map((m) => ({ value: m.userId, label: m.displayName }))]}
                    value={form.managerUserId ?? ''}
                    onChange={(v) => set({ managerUserId: v || null })}
                  />
                  <TextField label={t('hr.f.note')} value={form.note} onChangeText={(v) => set({ note: v })} multiline maxLength={300} />
                  {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
                  <Button label={t('hr.save')} loading={save.isPending} onPress={() => { setInfo(null); save.mutate(); }} />
                  <Button variant="ghost" label={t('hr.cancel')} onPress={() => { setEditing(null); setForm(null); setInfo(null); }} />
                </View>
              ) : (
                <Button variant="ghost" label={t('hr.emp.edit')} onPress={() => { setEditing(e.userId); setForm(formOf(e)); setInfo(null); }} />
              )}
            </Card>
          ))}
        </View>
      </Screen>
    </>
  );
}
