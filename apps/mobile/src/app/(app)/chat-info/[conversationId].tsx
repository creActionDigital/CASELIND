import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useI18n } from '../../../i18n';
import { conversationTitle, fetchConversation } from '../../../messaging/api';
import { DisappearingSetting } from '../../../messaging/DisappearingSetting';
import { qk } from '../../../messaging/keys';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, ErrorState, Screen, Text } from '../../../ui';

/** Infos d'une conversation directe : pair, messages éphémères, messages programmés. */
export default function ChatInfo() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = String(conversationId);
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const conv = useQuery({ queryKey: qk.conversation(id), queryFn: () => fetchConversation(id) });

  if (conv.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (conv.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={conv.error} onRetry={() => conv.refetch()} />
      </Screen>
    );
  }
  const c = conv.data;
  const title = conversationTitle(c, t);
  return (
    <Screen edges={['bottom']}>
      <Avatar name={title} size={64} />
      <Text variant="title" accessibilityRole="header" style={{ marginTop: spacing.md }}>
        {title}
      </Text>
      {c.peer ? (
        <Text variant="small" muted>
          @{c.peer.handle}
        </Text>
      ) : null}
      <DisappearingSetting conversation={c} />
      <Button
        variant="secondary"
        label={t('messagesX.scheduled.menu')}
        onPress={() => router.push({ pathname: '/scheduled', params: { conversationId: id } })}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}
