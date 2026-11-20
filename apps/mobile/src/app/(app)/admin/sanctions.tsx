import { SANCTION_DURATION_DAYS, type Sanction, type SanctionKind } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, DecisionPanel, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { issueSanction, liftSanction, fetchSanctions } from '../../../admin/ops2-api';
import { canLift, kindsFor, parseDuration, sanctionReady } from '../../../admin/ops2-logic';
import { UUID_RE } from '../../../admin/console-logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../ui';

const STATUSES = ['', 'active', 'appealed', 'lifted', 'expired'] as const;

function SanctionCard({ s }: { s: Sanction }) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const lift = useMutation({ mutationFn: (note: string) => liftSanction(s.id, note), onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }) });
  const name = s.userHandle ? `@${s.userHandle}` : s.userId.slice(0, 8);
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{name}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={s.kind === 'ban' ? 'accent' : 'neutral'} label={t(`ops2.kind.${s.kind}` as MessageKey)} />
        <Badge tone={s.status === 'active' || s.status === 'appealed' ? 'primary' : 'neutral'} label={t(`ops2.sanctionStatus.${s.status}` as MessageKey)} />
        {s.appeal ? <Badge tone="accent" label={t('ops2.sanctions.appealOpen', { status: t(`ops2.appealStatus.${s.appeal.status}` as MessageKey) })} /> : null}
      </View>
      <Text variant="small">{s.reason}</Text>
      <Text variant="small" muted>{when(s.startsAt, locale)} · {s.endsAt ? t('ops2.sanctions.until', { date: when(s.endsAt, locale) }) : t('ops2.sanctions.noEnd')}</Text>
      <DecisionPanel<'lift'>
        name={name}
        decisions={canLift(s, me?.roles) ? ['lift'] : []}
        needsReason={() => false}
        fieldLabel="ops2.sanctions.noteLabel"
        labelOf={() => t('ops2.sanctions.lift')}
        run={(_d, note) => lift.mutateAsync(note)}
      />
    </Card>
  );
}

function NewSanction({ initialUserId }: { initialUserId: string }) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const kinds = kindsFor(me?.roles);
  const [userId, setUserId] = useState(initialUserId);
  const [kind, setKind] = useState<SanctionKind>('warning');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = SANCTION_DURATION_DAYS[kind];
  const run = useMutation({
    mutationFn: () => issueSanction(userId.trim(), { kind, reason: reason.trim(), ...(range ? { durationDays: parseDuration(kind, days) as number } : {}) }),
    onSuccess: (data) => {
      setNotice('approvalId' in data ? t('ops2.pending') : t('ops2.sanctions.created'));
      setError(null);
      setReason('');
      setDays('');
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => { setNotice(null); setError(adminErrorMessage(e, t, locale)); },
  });
  const ready = UUID_RE.test(userId.trim()) && sanctionReady(kind, reason, days);
  const submit = () =>
    alertConfirm(t('adm.confirmTitle'), t('ops2.sanctions.confirm', { kind: t(`ops2.kind.${kind}` as MessageKey) }), [
      { text: t('adm.cancel'), style: 'cancel' },
      { text: t('ops2.sanctions.submit'), onPress: () => run.mutate() },
    ]);
  if (kinds.length === 0) return null;
  return (
    <Card style={{ gap: spacing.sm, marginHorizontal: spacing.md }}>
      <Text variant="bodyStrong">{t('ops2.sanctions.new')}</Text>
      <TextField label={t('ops2.sanctions.userId')} value={userId} onChangeText={setUserId} autoCapitalize="none" maxLength={40} />
      <Chips<SanctionKind> value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: t(`ops2.kind.${k}` as MessageKey) }))} />
      {range ? <TextField label={t('ops2.sanctions.days', { min: range.min, max: range.max })} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={3} /> : null}
      <TextField label={t('ops2.sanctions.reason')} value={reason} onChangeText={setReason} multiline maxLength={300} />
      {notice ? <Text variant="small" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button variant={kind === 'ban' ? 'danger' : 'primary'} label={t('ops2.sanctions.submit')} loading={run.isPending} disabled={!ready} onPress={submit} />
    </Card>
  );
}

/** Sanctions graduées : liste, nouvelle sanction (depuis une fiche : `?userId=`), levée. Le serveur décide de qui peut quoi. */
export default function Sanctions() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const params = useLocalSearchParams<{ userId?: string }>();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
  const query = useCursorList(['sanctions', status], (c) => fetchSanctions(status, '', c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<Sanction>
      title={t('ops2.sanctions.title')}
      query={query}
      keyExtractor={(s) => s.id}
      emptyTitle={t('adm.empty')}
      header={
        <View style={{ gap: spacing.sm }}>
          <NewSanction initialUserId={params.userId ?? ''} />
          <Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s ? t(`ops2.sanctionStatus.${s}` as MessageKey) : t('ops2.sanctions.all') }))} />
        </View>
      }
      renderItem={({ item }) => <SanctionCard s={item} />}
    />
  );
}
