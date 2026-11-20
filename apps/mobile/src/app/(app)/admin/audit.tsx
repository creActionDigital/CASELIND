import { useState } from 'react';
import { View } from 'react-native';
import { fetchAudit } from '../../../admin/console-api';
import { UUID_RE, auditQuery, auditRow, type AuditRow } from '../../../admin/console-logic';
import { AdminList, Denied, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { useI18n } from '../../../i18n';
import { Card } from '../../../seller/ui';
import { Text, TextField } from '../../../ui';

/** Journal d'audit (lecture seule, curseur). N'affiche que l'action, la date et des identifiants abrégés : ni IP, ni agent, ni détails. */
export default function Audit() {
  const { t, locale } = useI18n();
  const allowed = useHasRole(['admin']);
  const [action, setAction] = useState('');
  const [subject, setSubject] = useState('');
  const q = auditQuery(action, subject);
  const query = useCursorList(['audit', q.action ?? '', q.subjectUserId ?? ''], async (c) => {
    const p = await fetchAudit(q, c);
    return { items: p.items.map(auditRow), nextCursor: p.nextCursor };
  }, allowed);
  if (!allowed) return <Denied />;
  const badSubject = subject.trim() !== '' && !UUID_RE.test(subject.trim());
  return (
    <AdminList<AuditRow>
      title={t('adm.audit.title')}
      query={query}
      keyExtractor={(e) => e.id}
      emptyTitle={t('adm.empty')}
      emptyIcon="document-text-outline"
      header={
        <View style={[adminStyles.filters, { paddingHorizontal: 16, gap: 8 }]}>
          <TextField label={t('adm.audit.fieldAction')} value={action} onChangeText={setAction} autoCapitalize="none" autoCorrect={false} maxLength={100} />
          <TextField label={t('adm.audit.fieldSubject')} value={subject} onChangeText={setSubject} autoCapitalize="none" autoCorrect={false} maxLength={36} />
          {badSubject ? <Text variant="small" accessibilityLiveRegion="polite">{t('adm.audit.badSubject')}</Text> : null}
          <Text variant="caption" muted>{t('adm.audit.privacy')}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Card style={adminStyles.card}>
          <Text variant="bodyStrong" selectable>{item.action}</Text>
          <Text variant="small" muted>{when(item.when, locale)}</Text>
          {item.actor ? <Text variant="small" muted>{t('adm.audit.actor', { id: item.actor })}</Text> : null}
          {item.subject ? <Text variant="small" muted>{t('adm.audit.subject', { id: item.subject })}</Text> : null}
          {item.requestId ? <Text variant="caption" muted selectable>{t('adm.audit.request', { id: item.requestId })}</Text> : null}
        </Card>
      )}
    />
  );
}
