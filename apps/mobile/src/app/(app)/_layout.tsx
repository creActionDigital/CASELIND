import { Stack } from 'expo-router';
import { useI18n } from '../../i18n';
import { PushRouting } from '../../notifications/PushRouting';
import { ReportSheet } from '../../report/ReportSheet';
import { useTheme } from '../../theme/use-theme';

export default function AppLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <>
    <PushRouting />
    <ReportSheet />
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
      <Stack.Screen name="wallet/send" options={{ title: t('wallet.send.title') }} />
      <Stack.Screen name="wallet/topup" options={{ title: t('wallet.topup.title') }} />
      <Stack.Screen name="wallet/receive" options={{ title: t('wallet.receive.title') }} />
      <Stack.Screen name="wallet/pin" options={{ title: t('wallet.pin.title') }} />
      <Stack.Screen name="scan" options={{ title: t('scan.title') }} />
      <Stack.Screen name="pay" options={{ title: t('pay.title') }} />
      <Stack.Screen name="u/[handle]" options={{ title: t('profile.social.title') }} />
      <Stack.Screen name="seller"options={{ headerShown: false }} />
      <Stack.Screen name="cart" options={{ title: t('cart.title') }} />
      <Stack.Screen name="shop" options={{ title: t('shop.title') }} />
      <Stack.Screen name="product/[productId]" options={{ title: t('product.title') }} />
      <Stack.Screen name="store/[slug]" options={{ title: t('shop.title') }} />
      <Stack.Screen name="checkout" options={{ title: t('checkout.title') }} />
      <Stack.Screen name="orders/index" options={{ title: t('orders.title') }} />
      <Stack.Screen name="orders/[orderId]" options={{ title: t('orders.title') }} />
      <Stack.Screen name="review/new" options={{ presentation: 'modal', title: t('review.title') }} />
      <Stack.Screen name="messages/[conversationId]" options={{ title: t('messages.room') }} />
      <Stack.Screen name="group/[conversationId]" options={{ title: t('group.info') }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: t('compose.title') }} />
      <Stack.Screen name="post/[postId]" options={{ title: t('post.title') }} />
      <Stack.Screen name="user/[userId]/index" options={{ title: t('profile.social.title') }} />
      <Stack.Screen name="notification-preferences" options={{ title: t('notifications.preferences') }} />
      <Stack.Screen name="my-reports" options={{ title: t('report.mine.title') }} />
      <Stack.Screen name="favorites" options={{ title: t('messagesX.fav.title') }} />
      <Stack.Screen name="scheduled" options={{ title: t('messagesX.scheduled.title') }} />
      <Stack.Screen name="chat-info/[conversationId]" options={{ title: t('messagesX.info') }} />
      <Stack.Screen name="story/[userId]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="story/new" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
    </>
  );
}
