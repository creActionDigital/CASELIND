import type { MiniApp } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { cck, fetchMiniapps, reviewMiniapp } from '../../../admin/console-api';
import { decisionNeedsReason, miniappDecisions, type Decision } from '../../../admin/console-logic';
import { AdminList, DecisionPanel, Denied, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { Badge, Button, Text } from '../../../ui';

const STATUSES = ['in_review', 'published', 'suspended', 'rejected'] as const;

function AppCard({ a }: { a: MiniApp }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: (v: { d: Decision; note: string }) => reviewMiniapp(a.id, v.d, v.note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });
  return (
    <Card style={adminStyles.card}>
      <Text variant="bodyStrong">{a.name}</Text>
      {a.description ? <Text variant="small" muted numberOfLines={3}>{a.description}</Text> : null}
      <View style={adminStyles.badges}>
        <Badge tone={a.status === 'in_review' ? 'accent' : a.status === 'published' ? 'primary' : 'neutral'} label={t(`adm.status.${a.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted selectable>{a.launchUrl}</Text>
      <Text variant="small" muted>{t('adm.apps.scopes', { list: a.scopes.join(', ') || '-' })}</Text>
      <Text variant="small" muted>{when(a.updatedAt, locale)}</Text>
      {a.reviewNote ? <Text variant="small" muted>{t('adm.apps.note', { note: a.reviewNote })}</Text> : null}
      <DecisionPanel<Decision>
        name={a.name}
        decisions={miniappDecisions(a.status)}
        needsReason={(d) => d === 'reject'}
        fieldLabel="adm.apps.fieldNote"
        labelOf={(d) => t(`adm.decision.${d}` as MessageKey)}
        run={(d, note) => review.mutateAsync({ d, note })}
      />
    </Card>
  );
}

/** Revue des mini-apps soumises : approuver, refuser (note obligatoire), suspendre, rétablir. */
export default function MiniappsReview() {
  const { t } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('in_review');
  const router = useRouter();
  const query = useCursorList(['miniapps', status], (c) => fetchMiniapps(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<MiniApp>
      title={t('adm.apps.title')}
      query={query}
      keyExtractor={(a) => a.id}
      emptyTitle={t('adm.empty')}
      header={<><Button variant="secondary" label={t('mp.adm.open')} onPress={() => router.push('/admin/miniapp-versions' as never)} /><Chips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}` as MessageKey) }))} /></>}
      renderItem={({ item }) => <AppCard a={item} />}
    />
  );
}
