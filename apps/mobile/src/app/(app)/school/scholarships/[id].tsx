import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchScholarship, schsk } from '../../../../school/scholarships-api';
import { Card, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { Badge, Button, ErrorState, Text } from '../../../../ui';

/** Détail d'une bourse (lecture seule ; pas de candidature en ligne : le lien de l'école s'ouvre dans le navigateur). */
export default function ScholarshipDetail() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: schsk.one(id), queryFn: () => fetchScholarship(id) });
  const s = q.data;
  return (
    <>
      <Stack.Screen options={{ title: t('school.scholarships.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {s ? (
          <Card label={s.title}>
            <Text variant="title">{s.title}</Text>
            <Text variant="small" muted>
              {s.school.name}
              {s.school.city ? ` · ${s.school.city}` : ''}
            </Text>
            {s.school.verified ? <Badge tone="primary" label={t('school.verified')} /> : null}
            <Text>{s.description}</Text>
            <Text variant="small" muted>
              {s.deadline ? t('school.scholarships.deadline', { date: s.deadline }) : t('school.scholarships.noDeadline')}
            </Text>
            {s.url ? <Button label={t('school.scholarships.apply')} onPress={() => void Linking.openURL(s.url!)} /> : null}
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}
