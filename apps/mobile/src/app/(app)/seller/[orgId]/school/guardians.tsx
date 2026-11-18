import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { ApiRequestError } from '../../../../../lib/api';
import { fetchMembers, fetchOrgClasses, schk } from '../../../../../school/api';
import { fetchGuardians, guardianKeys, linkGuardian, removeGuardian } from '../../../../../school/guardians-api';
import { canLink, normalizeHandle, uniqueStudents } from '../../../../../school/guardians-logic';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Text, TextField } from '../../../../../ui';

/** Parents des élèves (personnel de l'établissement) : lien facultatif, que le parent doit accepter. */
export default function SchoolGuardians() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [student, setStudent] = useState<string | null>(null);
  const [parent, setParent] = useState('');
  const [relation, setRelation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const classes = useQuery({ queryKey: schk.classes(orgId), queryFn: () => fetchOrgClasses(orgId) });
  const memberQs = useQueries({ queries: (classes.data?.items ?? []).map((c) => ({ queryKey: schk.members(orgId, c.id), queryFn: () => fetchMembers(orgId, c.id) })) });
  const students = useMemo(() => uniqueStudents(memberQs.map((m) => m.data?.items ?? [])), [memberQs]);
  const links = useQuery({ queryKey: guardianKeys.staff(orgId), queryFn: () => fetchGuardians(orgId) });

  const refresh = () => void qc.invalidateQueries({ queryKey: guardianKeys.staff(orgId) });
  const add = useMutation({
    mutationFn: () => linkGuardian(orgId, { studentHandle: student!, guardianHandle: normalizeHandle(parent), relation: relation.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setParent('');
      setRelation('');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 404) setError(t('guardians.err.notFound'));
      else if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'duplicate_guardian') setError(t('guardians.err.duplicate'));
      else if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('reason') === 'same_person') setError(t('guardians.err.same'));
      else setError(sellerErrorMessage(e, t, locale));
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => removeGuardian(orgId, id), onSuccess: refresh });
  const loadingStudents = classes.isPending || memberQs.some((m) => m.isPending);

  return (
    <>
      <Stack.Screen options={{ title: t('guardians.staff.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <SectionTitle>{t('guardians.staff.pickStudent')}</SectionTitle>
        {loadingStudents ? <Loading /> : null}
        {classes.isError ? <ErrorState error={classes.error} onRetry={() => classes.refetch()} /> : null}
        {classes.data && !loadingStudents && students.length === 0 ? <Text muted>{t('guardians.staff.noStudents')}</Text> : null}
        <Chips scroll={false} options={students.map((s) => ({ value: s.handle, label: s.displayName }))} value={student} onChange={setStudent} />
        <TextField label={t('guardians.staff.handle')} value={parent} onChangeText={setParent} autoCapitalize="none" autoCorrect={false} maxLength={41} />
        <TextField label={t('guardians.staff.relation')} value={relation} onChangeText={setRelation} maxLength={40} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('guardians.staff.add')} loading={add.isPending} disabled={!canLink(student, parent)} onPress={() => add.mutate()} />

        {links.isPending ? <Loading /> : null}
        {links.isError ? <ErrorState error={links.error} onRetry={() => links.refetch()} /> : null}
        {links.data?.items.length === 0 ? <Text muted>{t('guardians.staff.empty')}</Text> : null}
        {links.data?.items.map((l) => (
          <Card key={l.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="bodyStrong">{t('guardians.staff.row', { parent: l.guardianDisplayName, student: l.studentDisplayName })}</Text>
                <Text variant="small" muted>
                  @{l.guardianHandle}
                  {l.relation ? ` · ${l.relation}` : ''}
                </Text>
                <Badge tone="neutral" label={t(`guardians.status.${l.status}` as const)} />
              </View>
              <Button variant="danger" label={t('guardians.staff.remove')} loading={remove.isPending && remove.variables === l.id} onPress={() => remove.mutate(l.id)} />
            </View>
          </Card>
        ))}
        <Text variant="small" muted>
          {t('guardians.staff.note')}
        </Text>
      </ScrollView>
    </>
  );
}
