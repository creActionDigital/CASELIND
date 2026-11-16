import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { createClass, fetchOrgClasses, schk } from '../../../../../school/api';
import { Card, Loading, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Text, TextField } from '../../../../../ui';

/** Classes d'un établissement (propriétaire ou administrateur) : liste et création. */
export default function SchoolClasses() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [name, setName] = useState('');
  const [yearLabel, setYearLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: schk.classes(orgId), queryFn: () => fetchOrgClasses(orgId) });
  const create = useMutation({
    mutationFn: () => createClass(orgId, { name: name.trim(), yearLabel: yearLabel.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: schk.classes(orgId) });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  return (
    <>
      <Stack.Screen options={{ title: t('school.staff.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <TextField label={t('school.staff.name')} value={name} onChangeText={setName} maxLength={80} />
        <TextField label={t('school.staff.year')} value={yearLabel} onChangeText={setYearLabel} maxLength={20} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('school.staff.create')} loading={create.isPending} disabled={!name.trim()} onPress={() => create.mutate()} />
        <Button variant="secondary" label={t('school.scholarships.manage')} onPress={() => router.push(`/seller/${orgId}/school/scholarships` as never)} />
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.map((c) => (
          <Card key={c.id} label={c.name} onPress={() => router.push(`/seller/${orgId}/school/${c.id}` as never)}>
            <Text variant="bodyStrong">{c.name}</Text>
            <Text variant="small" muted>
              {c.yearLabel ? `${c.yearLabel} · ` : ''}
              {t('school.staff.members', { n: c.memberCount })}
            </Text>
          </Card>
        ))}
        <Text variant="small" muted>
          {t('school.staff.consent')}
        </Text>
      </ScrollView>
    </>
  );
}
