import type { Shift } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { createShift, deleteShift, fetchEmployees, fetchShifts, hrKeys } from '../../../../../business/hr/api';
import { businessErrorMessage } from '../../../../../business/hr/errors';
import { addDays, buildShift, shiftsByDay, weekDays, weekStart, type ShiftForm } from '../../../../../business/hr/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { alertConfirm } from '../../../../../lib/confirm';
import { useMembership } from '../../../../../seller/api';
import { canManageHr } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/** Planning de la semaine (lundi au dimanche) : créneaux par employé, sans chevauchement. */
export default function Schedule() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending } = useMembership(orgId);
  const allowed = canManageHr(role);
  const [start, setStart] = useState(weekStart(new Date().toISOString().slice(0, 10)));
  const days = weekDays(start);
  const to = days[6]!;
  const [form, setForm] = useState<ShiftForm>({ userId: null, shiftDate: days[0]!, startsAt: '08:00', endsAt: '12:00', note: '' });
  const [info, setInfo] = useState<string | null>(null);
  const set = (p: Partial<ShiftForm>) => setForm((f) => ({ ...f, ...p }));

  const employees = useQuery({ queryKey: hrKeys.employees(orgId), queryFn: () => fetchEmployees(orgId), enabled: !!orgId && allowed });
  const shifts = useQuery({ queryKey: hrKeys.shifts(orgId, start, to), queryFn: () => fetchShifts(orgId, start, to), enabled: !!orgId && allowed });
  const refresh = () => void qc.invalidateQueries({ queryKey: [...hrKeys.all(orgId), 'shifts'] });
  const add = useMutation({
    mutationFn: () => {
      const built = buildShift(form);
      if ('error' in built) throw new Error(built.error);
      return createShift(orgId, built.ok);
    },
    onSuccess: () => { setInfo(null); refresh(); },
    onError: (e) => setInfo(/^(employee|date|time|order)$/.test((e as Error).message) ? t(`hr.err.${(e as Error).message}` as MessageKey) : businessErrorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteShift(orgId, id), onSuccess: refresh, onError: (e) => setInfo(businessErrorMessage(e, t, locale)) });
  const confirmDelete = (s: Shift) =>
    alertConfirm(t('hr.schedule.deleteConfirm'), `${s.displayName} ${s.shiftDate} ${s.startsAt}-${s.endsAt}`, [
      { text: t('hr.cancel'), style: 'cancel' },
      { text: t('hr.delete'), style: 'destructive', onPress: () => remove.mutate(s.id) },
    ]);

  const title = <Stack.Screen options={{ title: t('hr.schedule.title') }} />;
  if (isPending || employees.isPending || shifts.isPending) return <>{title}<Loading /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('hr.forbidden')}</Text></Screen></>;
  if (employees.isError) return <>{title}<ErrorState error={employees.error} onRetry={() => employees.refetch()} /></>;
  if (shifts.isError) return <>{title}<ErrorState error={shifts.error} onRetry={() => shifts.refetch()} /></>;

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Button variant="secondary" label={t('hr.schedule.prev')} onPress={() => setStart(addDays(start, -7))} />
            <Text variant="small" style={{ flex: 1, textAlign: 'center' }}>{start} {'->'} {to}</Text>
            <Button variant="secondary" label={t('hr.schedule.next')} onPress={() => setStart(addDays(start, 7))} />
          </View>
          {shiftsByDay(shifts.data.items, days).map((d) => (
            <Card key={d.date}>
              <Text variant="bodyStrong">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</Text>
              {d.items.length === 0 ? <Text variant="small" muted>{t('hr.schedule.noShift')}</Text> : null}
              {d.items.map((s) => (
                <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text variant="small" style={{ flex: 1 }}>{s.startsAt}-{s.endsAt} · {s.displayName}{s.note ? ` · ${s.note}` : ''}</Text>
                  <Button variant="ghost" label={t('hr.delete')} onPress={() => confirmDelete(s)} />
                </View>
              ))}
            </Card>
          ))}

          <SectionTitle>{t('hr.schedule.add')}</SectionTitle>
          <Chips options={employees.data.items.map((e) => ({ value: e.userId, label: e.displayName }))} value={form.userId} onChange={(userId) => set({ userId })} />
          <TextField label={t('hr.schedule.fieldDate')} value={form.shiftDate} onChangeText={(v) => set({ shiftDate: v })} maxLength={10} autoCapitalize="none" />
          <TextField label={t('hr.schedule.fieldStart')} value={form.startsAt} onChangeText={(v) => set({ startsAt: v })} maxLength={5} autoCapitalize="none" />
          <TextField label={t('hr.schedule.fieldEnd')} value={form.endsAt} onChangeText={(v) => set({ endsAt: v })} maxLength={5} autoCapitalize="none" />
          <TextField label={t('hr.schedule.fieldNote')} value={form.note} onChangeText={(v) => set({ note: v })} maxLength={100} />
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('hr.schedule.add')} loading={add.isPending} onPress={() => { setInfo(null); add.mutate(); }} />
        </View>
      </Screen>
    </>
  );
}
