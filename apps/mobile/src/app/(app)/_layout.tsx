import { Stack } from 'expo-router';
import { useI18n } from '../../i18n';
import { PushRouting } from '../../notifications/PushRouting';
import { useTheme } from '../../theme/use-theme';

export default function AppLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <>
    <PushRouting />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerBackTitle: t('common.back'),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: t('profile.title') }} />
      <Stack.Screen name="sessions" options={{ title: t('sessions.title') }} />
      <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
      <Stack.Screen name="language" options={{ title: t('language.title') }} />
      <Stack.Screen name="search" options={{ title: t('search.title') }} />
      <Stack.Screen name="wallet" options={{ title: t('wallet.title') }} />
      <Stack.Screen name="cart" options={{ title: t('cart.title') }} />
      <Stack.Screen name="messages/[conversationId]" options={{ title: t('messages.room') }} />
      <Stack.Screen name="group/[conversationId]" options={{ title: t('group.info') }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
      <Stack.Screen name="notification-preferences" options={{ title: t('notifications.preferences') }} />
    </Stack>
    </>
  );
}
