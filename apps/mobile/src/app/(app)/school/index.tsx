import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchMyClasses, schk } from '../../../school/api';
import { endMyParentLink, fetchMyParents } from '../../../school/guardians-api';
import { alertConfirm } from '../../../lib/confirm';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, ErrorState, Text } from '../../../ui';

/** Mes classes : celles où la personne est inscrite par son établissement (élève, parent ou enseignant). */
export default function MyClasses() {
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: schk.mine, queryFn: fetchMyClasses });
  const qc = useQueryClient();
  const parents = useQuery({ queryKey: ['school', 'my-parents'], queryFn: fetchMyParents });
  const endLink = useMutation({ mutationFn: endMyParentLink, onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'my-parents'] }) });
  return (
    <>
      <Stack.Screen options={{ title: t('school.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Button variant="secondary" label={t('school.search.link')} onPress={() => router.push('/school/search' as never)} />
        <Button variant="secondary" label={t('fees.link')} onPress={() => router.push('/school/fees' as never)} />
        <Button variant="secondary" label={t('guardians.me.link')} onPress={() => router.push('/school/children' as never)} />
        <Button variant="secondary" label={t('school.scholarships.link')} onPress={() => router.push('/school/scholarships' as never)} />
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.length === 0 ? <Text muted>{t('school.empty')}</Text> : null}
        {q.data?.items.map((c) => (
          <Card key={c.id} label={`${c.schoolName} ${c.name}`} onPress={() => router.push(`/school/${c.id}` as never)}>
            <Text variant="bodyStrong">{c.name}</Text>
            <Text variant="small" muted>
              {c.schoolName}
              {c.yearLabel ? ` · ${c.yearLabel}` : ''}
            </Text>
            <Badge tone="neutral" label={t(`school.role.${c.role}` as const)} />
          </Card>
        ))}
        {parents.data && parents.data.items.length > 0 ? <Text variant="bodyStrong">{t('school.parents.title')}</Text> : null}
        {parents.data?.items.map((p) => (
          <Card key={p.id} label={p.guardianDisplayName}>
            <Text variant="bodyStrong">{p.guardianDisplayName}</Text>
            <Text variant="small" muted>{`${p.schoolName} · ${p.relation}`}</Text>
            <Button
              variant="ghost"
              label={t('school.parents.end')}
              loading={endLink.isPending && endLink.variables === p.id}
              onPress={() => alertConfirm(t('school.parents.endConfirm', { name: p.guardianDisplayName }), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('school.parents.end'), style: 'destructive', onPress: () => endLink.mutate(p.id) }])}
            />
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
