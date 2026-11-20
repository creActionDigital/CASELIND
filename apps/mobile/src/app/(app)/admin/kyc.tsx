import type { AdminKycSubmission } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, decideKyc, fetchKyc } from '../../../admin/console-api';
import { decisionNeedsReason, kycDecisions, type Decision } from '../../../admin/console-logic';
import { AdminList, DecisionPanel, Denied, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { AuthImage, Badge, Button, Text } from '../../../ui';

const STATUSES = ['pending', 'approved', 'rejected'] as const;

function KycCard({ s }: { s: AdminKycSubmission }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [docs, setDocs] = useState(false);
  const decide = useMutation({
    mutationFn: (v: { d: Decision; reason: string }) => decideKyc(s.id, v.d === 'approve' ? 'approve' : 'reject', v.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  const name = s.legalName ?? s.userHandle ?? s.userId.slice(0, 8);
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{name}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={s.status === 'pending' ? 'accent' : s.status === 'approved' ? 'primary' : 'neutral'} label={t(`adm.status.${s.status}` as MessageKey)} />
        <Badge tone="neutral" label={t('adm.kyc.level', { n: s.level })} />
      </View>
      {s.userHandle ? <Text variant="small" muted>@{s.userHandle}{s.city ? ` · ${s.city}` : ''}</Text> : null}
      {s.idType && s.idNumberLast4 ? <Text variant="small" muted>{t('adm.kyc.id', { type: s.idType, last4: s.idNumberLast4 })}</Text> : null}
      <Text variant="small" muted>{when(s.createdAt, locale)}</Text>
      {s.decisionReason ? <Text variant="small" muted>{t('adm.kyc.reasonShown', { reason: s.decisionReason })}</Text> : null}
      {s.documents.length > 0 ? (
        <>
          <Button variant="ghost" label={t(docs ? 'adm.kyc.hideDocs' : 'adm.kyc.docs', { n: s.documents.length })} onPress={() => setDocs(!docs)} />
          {docs ? s.documents.map((d, i) => <AuthImage key={d.id} contentUrl={d.contentUrl} label={t('adm.kyc.doc', { n: i + 1 })} style={{ height: 220, width: '100%' }} />) : null}
        </>
      ) : null}
      <DecisionPanel<Decision>
        name={name}
        decisions={kycDecisions(s.status)}
        needsReason={decisionNeedsReason}
        labelOf={(d) => t(`adm.decision.${d}` as MessageKey)}
        run={(d, reason) => decide.mutateAsync({ d, reason })}
      />
    </Card>
  );
}

/** File de revue KYC : approuver, ou refuser avec motif. Les justificatifs ne se chargent qu'à la demande. */
export default function Kyc() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const query = useCursorList(['kyc', status], (c) => fetchKyc(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminKycSubmission>
      title={t('adm.kyc.title')}
      query={query}
      keyExtractor={(s) => s.id}
      emptyTitle={t('adm.empty')}
      header={<Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}` as MessageKey) }))} />}
      renderItem={({ item }) => <KycCard s={item} />}
    />
  );
}
