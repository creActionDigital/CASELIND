import type { AdminProfessional } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, fetchPros, reviewPro } from '../../../admin/console-api';
import { accountDecisions, decisionNeedsReason, type Decision } from '../../../admin/console-logic';
import { AdminList, DecisionPanel, Denied, adminStyles, useCursorList, useHasRole } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { Badge, Text } from '../../../ui';

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;

function ProCard({ p }: { p: AdminProfessional }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: (v: { d: 'approve' | 'reject' | 'suspend'; note: string }) => reviewPro(p.userId, v.d, v.note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{p.displayName}</Text>
      <Text variant="small" muted>@{p.handle} · {t(`adm.pro.kind.${p.kind}` as MessageKey)} · {p.specialty}</Text>
      <Text variant="small" muted>{p.city}</Text>
      <Text variant="small" muted selectable>{t('adm.pro.license', { n: p.licenseNumber })}</Text>
      <View style={adminStyles.badges}>
        <Badge tone={p.status === 'pending' ? 'accent' : p.status === 'approved' ? 'primary' : 'neutral'} label={t(`adm.status.${p.status}` as MessageKey)} />
      </View>
      {p.reviewNote ? <Text variant="small" muted>{t('adm.apps.note', { note: p.reviewNote })}</Text> : null}
      <DecisionPanel<Decision>
        name={p.displayName}
        decisions={accountDecisions(p.status)}
        needsReason={decisionNeedsReason}
        labelOf={(d) => t(`adm.decision.${d}` as MessageKey)}
        run={(d, note) => review.mutateAsync({ d: d as 'approve' | 'reject' | 'suspend', note })}
      />
    </Card>
  );
}

/** Approbation des professionnels de santé : vérification de la licence (admin). Aucune donnée de patient ici. */
export default function HealthPros() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const query = useCursorList(['pros', status], (c) => fetchPros(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminProfessional>
      title={t('adm.pro.title')}
      query={query}
      keyExtractor={(p) => p.userId}
      emptyTitle={t('adm.empty')}
      header={<Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}` as MessageKey) }))} />}
      renderItem={({ item }) => <ProCard p={item} />}
    />
  );
}
