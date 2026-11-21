import type { AdminAnnouncement } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { announcementAction, createAnnouncement, deleteAnnouncement, fetchAdminAnnouncements } from '../../../admin/ops2-api';
import { announcementActions, announcementReady, audienceLabel, audienceOf, endOfDayIso, type AnnouncementAction } from '../../../admin/ops2-logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../ui';

const STATUSES = ['', 'draft', 'published', 'ended'] as const;
type AudienceType = 'all' | 'role' | 'country';

function AnnouncementCard({ a }: { a: AdminAnnouncement }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async (what: AnnouncementAction) => {
      if (what === 'delete') await deleteAnnouncement(a.id);
      else await announcementAction(a.id, what);
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: cck.all }); },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });
  const label = (w: AnnouncementAction) => t(`ops2.ann.${w}` as MessageKey);
  const ask = (w: AnnouncementAction) =>
    alertConfirm(t('adm.confirmTitle'), t('ops2.ann.confirm', { action: label(w) }), [
      { text: t('adm.cancel'), style: 'cancel' },
      { text: label(w), onPress: () => run.mutate(w) },
    ]);
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{a.title}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={a.status === 'published' ? 'primary' : 'neutral'} label={t(`ops2.annStatus.${a.status}` as MessageKey)} />
        <Badge tone="neutral" label={t('ops2.ann.audienceLine', { audience: audienceLabel(a.audience, t) })} />
      </View>
      <Text variant="small">{a.body}</Text>
      <Text variant="caption" muted>{t('ops2.ann.period', { from: when(a.startsAt, locale), to: when(a.endsAt, locale) })}</Text>
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <View style={adminStyles.badges}>
        {announcementActions(a.status).map((w) => (
          <Button key={w} variant={w === 'publish' ? 'primary' : 'secondary'} label={label(w)} loading={run.isPending && run.variables === w} onPress={() => ask(w)} />
        ))}
      </View>
    </Card>
  );
}

function NewAnnouncement() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<AudienceType>('all');
  const [value, setValue] = useState('');
  const [endDay, setEndDay] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audience = audienceOf(type, value);
  const create = useMutation({
    mutationFn: () => createAnnouncement({ title: title.trim(), body: body.trim(), audience: audience!, endsAt: endOfDayIso(endDay)! }),
    onSuccess: () => { setNotice(t('ops2.ann.created')); setError(null); setTitle(''); setBody(''); void qc.invalidateQueries({ queryKey: cck.all }); },
    onError: (e) => { setNotice(null); setError(adminErrorMessage(e, t, locale)); },
  });
  return (
    <Card style={{ gap: spacing.sm, marginHorizontal: spacing.md }}>
      <Text variant="bodyStrong">{t('ops2.ann.new')}</Text>
      <TextField label={t('ops2.ann.titleField')} value={title} onChangeText={setTitle} maxLength={80} />
      <TextField label={t('ops2.ann.bodyField')} value={body} onChangeText={setBody} multiline maxLength={500} />
      <Chips<AudienceType> value={type} onChange={setType} options={(['all', 'role', 'country'] as const).map((k) => ({ value: k, label: t(`ops2.ann.audience.${k}` as MessageKey) }))} />
      {type !== 'all' ? <TextField label={t(type === 'role' ? 'ops2.ann.audienceValueRole' : 'ops2.ann.audienceValueCountry')} value={value} onChangeText={setValue} autoCapitalize="none" maxLength={12} /> : null}
      <TextField label={t('ops2.ann.endDay')} value={endDay} onChangeText={setEndDay} autoCapitalize="none" maxLength={10} />
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={t('ops2.ann.create')} loading={create.isPending} disabled={!audience || !announcementReady(title, body, endDay)} onPress={() => create.mutate()} />
    </Card>
  );
}

/** Annonces de la plateforme : créer un brouillon, publier, terminer (double validation non requise). */
export default function AdminAnnouncements() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
  const query = useCursorList(['announcements', status], (c) => fetchAdminAnnouncements(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminAnnouncement>
      title={t('ops2.ann.title')}
      query={query}
      keyExtractor={(a) => a.id}
      emptyTitle={t('adm.empty')}
      emptyIcon="megaphone-outline"
      header={
        <View style={{ gap: spacing.sm }}>
          <NewAnnouncement />
          <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s ? t(`ops2.annStatus.${s}` as MessageKey) : t('ops2.sanctions.all') }))} />
        </View>
      }
      renderItem={({ item }) => <AnnouncementCard a={item} />}
    />
  );
}
