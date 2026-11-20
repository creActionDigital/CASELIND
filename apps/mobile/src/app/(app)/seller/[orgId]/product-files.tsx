import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { fetchProductFiles, setProductFiles } from '../../../../digital/api';
import { useI18n } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { imageMime, uploadImage } from '../../../../media/upload';
import { Card, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Text } from '../../../../ui';

/** Fichiers vendus avec un produit numérique (catalog.manage). Images depuis la galerie ; PDF, vidéo, son : via l'API. */
export default function ProductFiles() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId, productId } = useLocalSearchParams<{ orgId: string; productId: string }>();
  const key = ['product-files', productId];
  const files = useQuery({ queryKey: key, queryFn: () => fetchProductFiles(orgId, productId) });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (ids: string[]) => setProductFiles(orgId, productId, ids),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(key, data);
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const ids = files.data?.items.map((f) => f.id) ?? [];

  async function add() {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 - ids.length, quality: 1 });
      if (res.canceled) return;
      const uploaded: string[] = [];
      for (const a of res.assets.slice(0, 5 - ids.length)) uploaded.push(await uploadImage(a.uri, imageMime(a.mimeType, a.uri), 'digital_file'));
      save.mutate([...ids, ...uploaded]);
    } catch (e) {
      setError(errorMessage(e, t, locale));
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('dig.files.title') }} />
      {files.isPending ? (
        <Loading />
      ) : files.isError ? (
        <ErrorState error={files.error} onRetry={() => files.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Text muted>{t('dig.files.intro')}</Text>
          {files.data.items.length === 0 ? (
            <Text variant="small" muted>
              {t('dig.files.none')}
            </Text>
          ) : null}
          {files.data.items.map((f, i) => (
            <Card key={f.id}>
              <Text>
                {f.mime} · {Math.max(1, Math.round(f.sizeBytes / 1024))} Ko
              </Text>
              <Button variant="secondary" label={t('dig.files.remove', { n: i + 1 })} loading={save.isPending} onPress={() => save.mutate(ids.filter((x) => x !== f.id))} />
            </Card>
          ))}
          {error ? (
            <Text color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {ids.length < 5 ? <Button label={t('dig.files.add')} loading={save.isPending} onPress={add} /> : null}
          <Text variant="caption" muted>
            {t('dig.files.pdfHint')}
          </Text>
        </ScrollView>
      )}
    </>
  );
}
