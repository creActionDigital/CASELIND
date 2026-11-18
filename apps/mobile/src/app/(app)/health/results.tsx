import type { HealthResult, HealthResultKind } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { isConsentRequired, todayLocal } from '../../../health/logic';
import { createResult, deleteResult, fetchResults, resultKeys } from '../../../health/results-api';
import { buildResult, RESULT_KINDS, resultErrorKey, resultKindKey } from '../../../health/results-logic';
import { useConsentRedirect } from '../../../health/use-consent-redirect';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { FileLinks } from '../../../media/FileLinks';
import { imageMime, uploadImage } from '../../../media/upload';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, Button, Text, TextField } from '../../../ui';

type Photo = { uri: string; mime: ReturnType<typeof imageMime> };

/** Mes résultats d'examens : liste, ajout (valeurs en texte libre, photo du compte rendu), détail, suppression avec confirmation. Privé et chiffré. */
export default function HealthResults() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<HealthResultKind | ''>('');
  const [kind, setKind] = useState<HealthResultKind>('blood');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: resultKeys.list(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchResults(filter, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useConsentRedirect(query.error);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['health', 'results'] });
  const fail = (e: unknown) => {
    if (isConsentRequired(e)) return setError(t('health.consent.title'));
    const key = resultErrorKey(e);
    setError(key ? t(key) : errorMessage(e, t, locale));
  };

  const add = useMutation({
    mutationFn: async () => {
      const built = buildResult({ kind, title, summary, date }, todayLocal());
      if (!built.ok) throw new Error(built.error);
      const assetId = photo ? await uploadImage(photo.uri, photo.mime, 'health_result') : null;
      return createResult({ ...built.body, assetId });
    },
    onSuccess: () => {
      setError(null);
      setTitle('');
      setSummary('');
      setPhoto(null);
      refresh();
    },
    onError: (e) => (e instanceof Error && e.message.startsWith('health.results.err.') ? setError(t(e.message as Parameters<typeof t>[0])) : fail(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteResult(id),
    onSuccess: () => {
      setConfirm(null);
      setOpen(null);
      refresh();
    },
    onError: fail,
  });

  async function pickPhoto() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(t('health.results.photoDenied'));
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const a = res.canceled ? null : res.assets[0];
    if (a) setPhoto({ uri: a.uri, mime: imageMime(a.mimeType, a.uri) });
  }

  const form = (
    <View style={styles.form}>
      <Text variant="small" muted>
        {t('health.results.hint')}
      </Text>
      <Chips options={RESULT_KINDS.map((k) => ({ value: k, label: t(resultKindKey(k)) }))} value={kind} onChange={setKind} />
      <TextField label={t('health.results.fieldTitle')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField label={t('health.results.fieldSummary')} value={summary} onChangeText={setSummary} multiline maxLength={2000} />
      <TextField label={t('health.results.fieldDate')} value={date} onChangeText={setDate} autoCapitalize="none" maxLength={10} />
      <Button variant="secondary" label={photo ? t('health.results.photoDone') : t('health.results.photo')} onPress={() => void pickPhoto()} />
      {photo ? <Button variant="ghost" label={t('health.results.photoRemove')} onPress={() => setPhoto(null)} /> : null}
      <Text variant="small" muted>
        {t('health.results.pdfLater')}
      </Text>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('health.results.add')} loading={add.isPending} disabled={!title.trim()} onPress={() => add.mutate()} />
      <Chips options={[{ value: '' as const, label: t('health.all') }, ...RESULT_KINDS.map((k) => ({ value: k, label: t(resultKindKey(k)) }))]} value={filter} onChange={(v) => setFilter(v === filter ? '' : v)} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('health.results.title') }} />
      <PagedList
        query={query}
        keyExtractor={(r: HealthResult) => r.id}
        header={form}
        renderItem={({ item }) => {
          const expanded = open === item.id;
          return (
            <Card style={styles.card}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : item.id)} style={styles.pressable}>
                <View style={styles.row}>
                  <Badge tone="neutral" label={t(resultKindKey(item.kind))} />
                  <Text variant="small" muted>
                    {item.resultDate}
                  </Text>
                </View>
                <Text variant="bodyStrong">{item.title}</Text>
                {item.summary ? (
                  <Text variant="small" numberOfLines={expanded ? undefined : 2}>
                    {item.summary}
                  </Text>
                ) : null}
              </Pressable>
              {expanded ? (
                <View style={styles.detail}>
                  {item.provider ? (
                    <Text variant="small" muted>
                      {t('health.results.provider', { name: item.provider.displayName })}
                    </Text>
                  ) : null}
                  {item.file?.mime.startsWith('image/') ? <AuthImage contentUrl={item.file.contentUrl} label={t('health.results.file')} style={styles.image} /> : null}
                  {item.file && !item.file.mime.startsWith('image/') ? <FileLinks files={[item.file]} label={t('health.results.file')} /> : null}
                  {confirm === item.id ? (
                    <>
                      <Text variant="bodyStrong">{t('health.results.deleteConfirm')}</Text>
                      <Button variant="danger" label={t('health.results.deleteYes')} loading={remove.isPending} onPress={() => remove.mutate(item.id)} />
                      <Button variant="ghost" label={t('common.cancel')} onPress={() => setConfirm(null)} />
                    </>
                  ) : (
                    <Button variant="ghost" label={t('health.results.delete')} onPress={() => setConfirm(item.id)} />
                  )}
                </View>
              ) : null}
            </Card>
          );
        }}
        empty={{ icon: 'flask-outline', title: t('health.results.empty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: spacing.lg, gap: spacing.md },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs, borderRadius: radius.md },
  pressable: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detail: { gap: spacing.sm, marginTop: spacing.sm },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden' },
});
