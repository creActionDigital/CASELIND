import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { devKeys, fetchMyApps } from '../../../../miniapps/developer/api';
import { Card, Loading } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { Badge, Button, ErrorState, Screen, Text } from '../../../../ui';

/** Portail développeur : mes applications (celles des organisations dont je suis propriétaire). */
export default function DeveloperHome() {
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: devKeys.apps, queryFn: fetchMyApps });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('miniapps.dev.title') }} />
      <View style={{ gap: spacing.md }}>
        <Button label={t('miniapps.dev.new')} onPress={() => router.push('/miniapps/developer/new' as never)} />
        <Text variant="caption" muted>{t('miniapps.dev.guide')}</Text>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data && q.data.items.length === 0 ? <Text muted>{t('miniapps.dev.empty')}</Text> : null}
        {q.data?.items.map((a) => (
          <Card key={a.id} label={a.name} onPress={() => router.push(`/miniapps/developer/${a.id}` as never)}>
            <Text variant="bodyStrong">{a.name}</Text>
            <View style={{ alignSelf: 'flex-start' }}><Badge tone={a.status === 'published' ? 'accent' : 'neutral'} label={t(`miniapps.dev.status.${a.status}` as MessageKey)} /></View>
            <Text variant="small" muted>{a.currentVersion ? t('miniapps.dev.version', { version: a.currentVersion }) : t('miniapps.dev.noVersion')}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
