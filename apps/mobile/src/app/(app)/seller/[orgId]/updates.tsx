import type { OrgUpdate } from '@caselind/contracts';
import { alertConfirm } from '../../../../lib/confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { useMembership } from '../../../../seller/api';
import { canEditProfile } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';
import { createOrgUpdate, deleteOrgUpdate, fetchOrgUpdates, patchOrgUpdate, updatesKeys } from '../../../../vitrine/updates-api';
import { buildUpdate, emptyForm, formatRange, formOf, type UpdateForm } from '../../../../vitrine/updates-logic';

const KINDS = ['post', 'promo', 'event'] as const;

/** « Actualités » (permission `org.profile.edit`) : publications, promotions et événements de la page publique. */
export default function OrgUpdates() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, membership, isPending, isError, error, refetch } = useMembership(orgId);
  const list = useQuery({ queryKey: updatesKeys.staff(orgId), queryFn: () => fetchOrgUpdates(orgId), enabled: !!orgId });
  const [form, setForm] = useState<UpdateForm>(emptyForm());
  const [editing, setEditing] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const done = () => {
    setForm(emptyForm());
    setEditing(null);
    setInfo(null);
    void qc.invalidateQueries({ queryKey: updatesKeys.staff(orgId) });
    if (membership) void qc.invalidateQueries({ queryKey: updatesKeys.public(membership.org.slug) });
  };
  const fail = (e: unknown) => setInfo(sellerErrorMessage(e, t, locale));
  const save = useMutation({
    mutationFn: () => {
      const built = buildUpdate(form);
      if ('error' in built) throw new Error(built.error);
      return editing ? patchOrgUpdate(orgId, editing, built.ok) : createOrgUpdate(orgId, built.ok);
    },
    onSuccess: done,
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (/^(title|body|startsAt|startsRequired|endsAt|endBeforeStart)$/.test(m)) setInfo(t(`vitrine.updates.err.${m}` as MessageKey));
      else if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'limit') setInfo(t('vitrine.updates.err.limit'));
      else setInfo(sellerErrorMessage(e, t, locale));
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteOrgUpdate(orgId, id), onSuccess: done, onError: fail });

  const title = <Stack.Screen options={{ title: t('vitrine.updates.title') }} />;
  if (isPending || list.isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (list.isError) return <>{title}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;
  if (!canEditProfile(role)) return <>{title}<Screen><Text muted>{t('vitrine.updates.forbidden')}</Text></Screen></>;

  const confirmDelete = (u: OrgUpdate) =>
    alertConfirm(u.title, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('vitrine.updates.delete'), style: 'destructive', onPress: () => remove.mutate(u.id) },
    ]);
  const set = (patch: Partial<UpdateForm>) => setForm((f) => ({ ...f, ...patch }));
  const kindLabel = (k: OrgUpdate['kind']) => t(`vitrine.updates.kind.${k}` as MessageKey);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Chips flush options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} value={form.kind} onChange={(kind) => set({ kind })} />
          <TextField label={t('vitrine.updates.fieldTitle')} value={form.title} onChangeText={(v) => set({ title: v })} maxLength={80} />
          <TextField label={t('vitrine.updates.fieldBody')} value={form.body} onChangeText={(v) => set({ body: v })} multiline maxLength={1000} />
          {form.kind !== 'post' ? (
            <>
              <TextField label={t('vitrine.updates.fieldStarts')} value={form.startsAt} onChangeText={(v) => set({ startsAt: v })} autoCapitalize="none" />
              <TextField label={t('vitrine.updates.fieldEnds')} value={form.endsAt} onChangeText={(v) => set({ endsAt: v })} autoCapitalize="none" />
            </>
          ) : null}
          {form.kind === 'event' ? <TextField label={t('vitrine.updates.fieldPlace')} value={form.place} onChangeText={(v) => set({ place: v })} maxLength={120} /> : null}
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t(editing ? 'vitrine.updates.save' : 'vitrine.updates.add')} loading={save.isPending} onPress={() => { setInfo(null); save.mutate(); }} />
          {editing ? <Button variant="secondary" label={t('vitrine.updates.cancel')} onPress={done} /> : null}

          <SectionTitle>{t('vitrine.updates.title')}</SectionTitle>
          {list.data.items.length === 0 ? <Text muted>{t('vitrine.updates.empty')}</Text> : null}
          {list.data.items.map((u) => (
            <Card key={u.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Badge label={kindLabel(u.kind)} tone={u.kind === 'promo' ? 'accent' : u.kind === 'event' ? 'primary' : 'neutral'} />
                {u.hidden ? <Badge label={t('vitrine.updates.hidden')} tone="neutral" /> : null}
              </View>
              <Text variant="bodyStrong">{u.title}</Text>
              {formatRange(u) ? <Text variant="small" muted>{[formatRange(u), u.place].filter(Boolean).join(' · ')}</Text> : null}
              <Text>{u.body}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button variant="secondary" label={t('vitrine.updates.edit')} onPress={() => { setEditing(u.id); setForm(formOf(u)); setInfo(null); }} />
                <Button variant="secondary" label={t('vitrine.updates.delete')} loading={remove.isPending && remove.variables === u.id} onPress={() => confirmDelete(u)} />
              </View>
            </Card>
          ))}
        </View>
      </Screen>
    </>
  );
}
