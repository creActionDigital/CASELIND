import { useQuery } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ErrorState } from '../../../ui';
import { fetchUserByHandle } from '../../../wallet/api';

/** Lien de profil `caselind://u/<handle>` (QR de profil) : résout le handle puis ouvre le profil social. */
export default function ProfileByHandle() {
  const { t } = useI18n();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const q = useQuery({ queryKey: ['profile-by-handle', handle], queryFn: () => fetchUserByHandle(String(handle)), retry: false });
  if (q.data) return <Redirect href={{ pathname: '/user/[userId]', params: { userId: q.data.id } }} />;
  return (
    <>
      <Stack.Screen options={{ title: t('profile.social.title') }} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      )}
    </>
  );
}
