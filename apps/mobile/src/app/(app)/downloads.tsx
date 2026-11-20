import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { fetchDownloads } from '../../digital/api';
import { useI18n } from '../../i18n';
import { FileLinks } from '../../media/FileLinks';
import { Card, Loading } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { EmptyState, ErrorState, Text } from '../../ui';

/** Fichiers des produits numériques des commandes livrées (accès contrôlé par le serveur). */
export default function Downloads() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['me', 'downloads'], queryFn: fetchDownloads });
  return (
    <>
      <Stack.Screen options={{ title: t('dig.downloads.title') }} />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon="download-outline" title={t('dig.downloads.empty')} body={t('dig.downloads.emptyBody')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          {q.data.items.map((d) => (
            <Card key={`${d.orderId}-${d.productId}`}>
              <View style={{ gap: spacing.xs }}>
                <Text variant="bodyStrong">{d.title}</Text>
                <Text variant="caption" muted>
                  {new Date(d.deliveredAt).toLocaleDateString(locale)}
                </Text>
                <FileLinks files={d.files} label={t('dig.downloads.file')} />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </>
  );
}
