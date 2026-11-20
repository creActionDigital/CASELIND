import type { AdminAppeal } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck } from '../../../admin/console-api';
import { AdminList, DecisionPanel, Denied, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { decideAppeal, fetchAppeals } from '../../../admin/ops2-api';
import { canDecide } from '../../../admin/ops2-logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { Badge, Text } from '../../../ui';

const STATUSES = ['pending', 'accepted', 'rejected'] as const;
type D = 'accepted' | 'rejected';

function AppealCard({ a }: { a: AdminAppeal }) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (v: { d: D; note: string }) => decideAppeal(a.id, v.d, v.note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  const name = a.userHandle ? `@${a.userHandle}` : a.userId.slice(0, 8);
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{name}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={a.status === 'pending' ? 'accent' : 'neutral'} label={t(`ops2.appealStatus.${a.status}` as MessageKey)} />
        <Badge tone="neutral" label={t('ops2.appeals.sanction', { kind: t(`ops2.kind.${a.sanctionKind}` as MessageKey), status: t(`ops2.sanctionStatus.${a.sanctionStatus}` as MessageKey) })} />
      </View>
      <Text variant="small" muted>{a.sanctionReason}</Text>
      <Text variant="small">{a.message}</Text>
      <Text variant="caption" muted>{when(a.createdAt, locale)}</Text>
      {a.decisionNote ? <Text variant="small" muted>{t('ops2.mine.decision', { note: a.decisionNote })}</Text> : null}
      <DecisionPanel<D>
        name={name}
        decisions={canDecide(a, me?.roles) ? ['accepted', 'rejected'] : []}
        needsReason={() => false}
        fieldLabel="ops2.sanctions.noteLabel"
        labelOf={(d) => t(d === 'accepted' ? 'ops2.appeals.accept' : 'ops2.appeals.reject')}
        run={(d, note) => decide.mutateAsync({ d, note })}
      />
    </Card>
  );
}

/** File des recours : accepter lève la sanction, rejeter la remet en vigueur. Un modérateur ne tranche que les avertissements et blocages. */
export default function Appeals() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const query = useCursorList(['appeals', status], (c) => fetchAppeals(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminAppeal>
      title={t('ops2.appeals.title')}
      query={query}
      keyExtractor={(a) => a.id}
      emptyTitle={t('adm.empty')}
      header={<Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`ops2.appealStatus.${s}` as MessageKey) }))} />}
      renderItem={({ item }) => <AppealCard a={item} />}
    />
  );
}
