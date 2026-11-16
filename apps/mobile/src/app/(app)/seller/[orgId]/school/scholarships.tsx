import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { closeScholarship, fetchOrgScholarships, publishScholarship, schsk, updateScholarship } from '../../../../../school/scholarships-api';
import { Card, PagedList, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../../../ui';

/** Bourses de l'établissement (propriétaire ou administrateur) : publier et clôturer. */
export default function OrgScholarships() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: schsk.org(orgId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrgScholarships(orgId, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: schsk.org(orgId) });
  const publish = useMutation({
    mutationFn: () => publishScholarship(orgId, { title: title.trim(), description: description.trim(), deadline: deadline.trim() || undefined, url: url.trim() || undefined }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setDeadline('');
      setUrl('');
      refresh();
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  const reset = () => {
    setEditing(null);
    setTitle('');
    setDescription('');
    setDeadline('');
    setUrl('');
  };
  const save = useMutation({
    mutationFn: (id: string) => updateScholarship(orgId, id, { title: title.trim(), description: description.trim(), deadline: deadline.trim() || undefined, url: url.trim() || undefined }),
    onMutate: () => setError(null),
    onSuccess: () => {
      reset();
      refresh();
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  const close = useMutation({ mutationFn: (id: string) => closeScholarship(orgId, id), onSuccess: refresh, onError: (e) => setError(sellerErrorMessage(e, t, locale)) });
  const form = (
    <View style={styles.form}>
      <TextField label={t('school.scholarships.formTitle')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField label={t('school.scholarships.formDesc')} value={description} onChangeText={setDescription} maxLength={2000} multiline />
      <TextField label={t('school.scholarships.formDeadline')} value={deadline} onChangeText={setDeadline} maxLength={10} autoCapitalize="none" />
      <TextField label={t('school.scholarships.formUrl')} value={url} onChangeText={setUrl} maxLength={500} autoCapitalize="none" keyboardType="url" />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        label={t(editing ? 'school.scholarships.save' : 'school.scholarships.publish')}
        loading={publish.isPending || save.isPending}
        disabled={!title.trim() || !description.trim()}
        onPress={() => (editing ? save.mutate(editing) : publish.mutate())}
      />
      {editing ? <Button variant="secondary" label={t('school.scholarships.cancelEdit')} onPress={reset} /> : null}
    </View>
  );
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('school.scholarships.manage') }} />
      <PagedList
        query={query}
        keyExtractor={(s) => s.id}
        header={form}
        renderItem={({ item }) => (
          <View style={styles.pad}>
            <Card label={item.title}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text variant="small" muted>
                {item.deadline ? t('school.scholarships.deadline', { date: item.deadline }) : t('school.scholarships.noDeadline')}
              </Text>
              <Badge tone={item.status === 'open' ? 'primary' : 'neutral'} label={t(item.status === 'open' ? 'school.scholarships.open' : 'school.scholarships.closed')} />
              {item.status === 'open' ? (
                <Button
                  variant="secondary"
                  label={t('school.scholarships.edit')}
                  onPress={() => {
                    setEditing(item.id);
                    setTitle(item.title);
                    setDescription(item.description);
                    setDeadline(item.deadline ?? '');
                    setUrl(item.url ?? '');
                  }}
                />
              ) : null}
              {item.status === 'open' ? <Button variant="secondary" label={t('school.scholarships.close')} loading={close.isPending && close.variables === item.id} onPress={() => close.mutate(item.id)} /> : null}
            </Card>
          </View>
        )}
        empty={{ icon: 'ribbon-outline', title: t('school.scholarships.emptyTitle') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: spacing.lg, gap: spacing.sm },
  pad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
