import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { devKeys, fetchActivity } from '../../../../miniapps/developer/api';
import { Card, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { Button, ErrorState, Screen, Text } from '../../../../ui';

/** Ce qu'une application a lu de MES données (90 jours) : accès et date, jamais le contenu. */
export default function MiniAppActivity() {
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const { t, locale } = useI18n();
  const q = useInfiniteQuery({
    queryKey: devKeys.activity(appId),
    queryFn: ({ pageParam }) => fetchActivity(appId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('miniapps.activity.title') }} />
      <View style={{ gap: spacing.md }}>
        <Text variant="small" muted>{t('miniapps.activity.hint')}</Text>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data && items.length === 0 ? <Text muted>{t('miniapps.activity.empty')}</Text> : null}
        {items.map((i) => (
          <Card key={i.id}>
            <Text variant="bodyStrong">{t(`miniapps.activity.resource.${i.resource}` as MessageKey)}</Text>
            <Text variant="small" muted>{t(`miniapps.scope.${i.scope}` as MessageKey)}</Text>
            <Text variant="caption" muted>{new Date(i.at).toLocaleString(locale)}</Text>
          </Card>
        ))}
        {q.hasNextPage ? <Button variant="ghost" label={t('miniapps.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : null}
      </View>
    </Screen>
  );
}
