import type { ModerationReportGroup } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, fetchModeration, moderate } from '../../../admin/console-api';
import { MOD_STATUSES, MOD_TYPES, moderationActions, moderationQuery, type ModAction } from '../../../admin/console-logic';
import { AdminList, DecisionPanel, adminStyles, useCursorList, useHasRole, when, Denied } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips } from '../../../seller/ui';
import { Badge, Text } from '../../../ui';

type Status = (typeof MOD_STATUSES)[number];

/** File de signalements regroupés par contenu. L'API ne renvoie pas le contenu lui-même : type, identifiant, motifs. */
export default function Moderation() {
  const { t, locale } = useI18n();
  const allowed = useHasRole(['admin', 'moderator']);
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('open');
  const [type, setType] = useState('');
  const query = useCursorList(['moderation', status, type], (c) => fetchModeration(moderationQuery(status, type), c), allowed);
  const act = useMutation({
    mutationFn: moderate,
    onSuccess: () => void qc.invalidateQueries({ queryKey: cck.all }),
  });

  if (!allowed) return <Denied />;
  const typeLabel = (k: string) => t(`adm.type.${k}` as MessageKey);

  return (
    <AdminList<ModerationReportGroup>
      title={t('adm.mod.title')}
      query={query}
      keyExtractor={(g) => `${g.targetType}:${g.targetId}`}
      emptyTitle={t('adm.empty')}
      header={
        <View style={adminStyles.filters}>
          <Chips<Status> value={status} onChange={setStatus} options={MOD_STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}` as MessageKey) }))} />
          <Chips<string> value={type} onChange={setType} options={[{ value: '', label: t('adm.all') }, ...MOD_TYPES.map((k) => ({ value: k, label: typeLabel(k) }))]} />
          <Text variant="caption" muted style={{ paddingHorizontal: 16 }}>{t('adm.mod.contentNote')}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Card style={adminStyles.card}>
          <Text variant="bodyStrong">{typeLabel(item.targetType)}</Text>
          <Text variant="caption" muted selectable>{item.targetId}</Text>
          <View style={adminStyles.badges}>
            <Badge tone={item.status === 'open' ? 'accent' : 'neutral'} label={t(`adm.status.${item.status}` as MessageKey)} />
            <Badge tone="primary" label={t('adm.mod.reports', { n: item.reportCount })} />
            {item.reasons.map((r) => (
              <Badge key={r.reason} tone="neutral" label={`${t(`adm.reason.${r.reason}` as MessageKey)} ×${r.count}`} />
            ))}
          </View>
          <Text variant="small" muted>{item.authorId ? t('adm.mod.author', { id: item.authorId.slice(0, 8) }) : t('adm.mod.noAuthor')}</Text>
          <Text variant="small" muted>{t('adm.mod.first', { date: when(item.firstReportedAt, locale) })} · {t('adm.mod.last', { date: when(item.lastReportedAt, locale) })}</Text>
          <DecisionPanel<ModAction>
            name={typeLabel(item.targetType)}
            decisions={moderationActions(item.status)}
            needsReason={() => false}
            fieldLabel="adm.note"
            labelOf={(a) => t(`adm.mod.action.${a}` as MessageKey)}
            run={(a, note) => act.mutateAsync({ targetType: item.targetType, targetId: item.targetId, action: a, note: note || undefined })}
          />
        </Card>
      )}
    />
  );
}
