import { AI_MESSAGE_MAX_CHARS, type AiMessage, type AiMessageList } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { aiKeys, deleteAiConversation, fetchAiMessages, sendAiMessage } from '../../../ai/api';
import { aiErrorKey } from '../../../ai/logic';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState, IconButton, Screen, Text } from '../../../ui';

/** Conversation avec l'assistant : la question part au modèle choisi, la réponse indique le modèle utilisé. */
export default function AiChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const messages = useQuery({ queryKey: aiKeys.messages(id), queryFn: () => fetchAiMessages(id) });

  const send = useMutation({
    mutationFn: (content: string) => sendAiMessage(id, content),
    onSuccess: (res) => {
      qc.setQueryData<AiMessageList>(aiKeys.messages(id), (old) => ({
        items: [...(old?.items ?? []), res.userMessage, res.reply],
      }));
      setNotice(res.fallbackUsed ? t('ai.fallbackUsed', { model: res.modelId }) : null);
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
    },
    onError: (err, content) => setDraft(content), // garde la question pour pouvoir la renvoyer
  });

  const remove = useMutation({
    mutationFn: () => deleteAiConversation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
      router.back();
    },
  });

  function submit() {
    const content = draft.trim();
    if (!content || send.isPending) return;
    setDraft('');
    send.mutate(content);
  }

  function confirmDelete() {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (globalThis.confirm?.(t('ai.deleteConfirm'))) remove.mutate();
      return;
    }
    Alert.alert(t('ai.delete'), t('ai.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('ai.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  }

  const sendError = send.isError ? (aiErrorKey(send.error) ? t(aiErrorKey(send.error)!) : errorMessage(send.error, t, locale)) : null;
  const items = messages.data?.items ?? [];

  return (
    <Screen edges={['bottom']} padded={false}>
      <Stack.Screen
        options={{
          title: t('ai.title'),
          headerRight: () => <IconButton icon="trash-outline" label={t('ai.delete')} onPress={confirmDelete} />,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.isError ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={messages.isLoading ? <ActivityIndicator /> : <EmptyState icon="sparkles-outline" title={t('ai.emptyTitle')} body={t('ai.emptyBody')} />}
            renderItem={({ item }) => <Bubble m={item} />}
            ListFooterComponent={
              <View style={{ gap: spacing.sm }}>
                {send.isPending ? (
                  <Text variant="small" muted accessibilityLiveRegion="polite">
                    {t('ai.thinking')}
                  </Text>
                ) : null}
                {notice ? <Text variant="small" muted>{notice}</Text> : null}
                {sendError ? (
                  <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                    {sendError}
                  </Text>
                ) : null}
              </View>
            }
          />
        )}
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('ai.placeholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('ai.placeholder')}
            multiline
            maxLength={AI_MESSAGE_MAX_CHARS}
            style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          />
          <IconButton icon="arrow-up-circle" label={t('ai.send')} onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({ m }: { m: AiMessage }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const mine = m.role === 'user';
  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        accessible
        accessibilityLabel={`${mine ? t('ai.you') : t('ai.assistant')} : ${m.content}`}
        style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.surface }]}
      >
        <Text color={mine ? colors.onPrimary : colors.text} selectable>
          {m.content}
        </Text>
        {!mine && m.modelId ? (
          <Text variant="caption" muted style={{ marginTop: spacing.xs }}>
            {t('ai.generatedBy', { model: m.modelId })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 140, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
