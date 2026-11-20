import { AI_MESSAGE_MAX_CHARS, type AiActionList, type AiMessage, type AiMessageList } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { aiKeys, deleteAiConversation, fetchAiMessages, fetchAiModels, fetchAiSettings, sendAiMessage } from '../../../ai/api';
import { aiErrorKey, effectiveModel } from '../../../ai/logic';
import { ActionCards } from '../../../ai/ActionCards';
import { assistKeys, fetchAiActions } from '../../../ai/assist-api';
import { consentNeeded } from '../../../ai/assist-logic';
import { ConsentSheet } from '../../../ai/ConsentSheet';
import { setConsent } from '../../../privacy/api';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { ErrorState, IconButton, Screen, Text } from '../../../ui';

/** Conversation avec l'assistant : la question part au modèle choisi, la réponse indique le modèle utilisé. */
export default function AiChat() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const messages = useQuery({ queryKey: aiKeys.messages(id), queryFn: () => fetchAiMessages(id) });
  const models = useQuery({ queryKey: aiKeys.models, queryFn: fetchAiModels });
  const settings = useQuery({ queryKey: aiKeys.settings, queryFn: fetchAiSettings });
  const model = models.data && settings.data ? effectiveModel(models.data.items, settings.data, models.data.defaultModelId) : undefined;
  const autoSent = useRef(false);
  const actionsQ = useQuery({ queryKey: assistKeys.actions(id), queryFn: () => fetchAiActions(id) });
  // Consentement ai_processing manquant : feuille d'information, puis on relance ce qui a échoué.
  const retryRef = useRef<(() => void) | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const send = useMutation({
    mutationFn: (content: string) => sendAiMessage(id, content),
    onSuccess: (res) => {
      qc.setQueryData<AiMessageList>(aiKeys.messages(id), (old) => ({
        items: [...(old?.items ?? []), res.userMessage, res.reply],
      }));
      qc.setQueryData<AiActionList>(assistKeys.actions(id), (old) => ({ items: [...(old?.items ?? []), ...res.actions] }));
      setNotice(res.fallbackUsed ? t('ai.fallbackUsed', { model: res.modelId }) : null);
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
    },
    onError: (err, content) => {
      setDraft(content); // garde la question pour pouvoir la renvoyer
      if (consentNeeded(err) === 'ai_processing') {
        retryRef.current = () => {
          setDraft('');
          send.mutate(content);
        };
        setNeedConsent(true);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteAiConversation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
      router.back();
    },
  });

  // Question saisie sur l'accueil : envoyée une seule fois à l'ouverture de la conversation.
  useEffect(() => {
    if (q && !autoSent.current) {
      autoSent.current = true;
      send.mutate(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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

  async function acceptConsent() {
    setAccepting(true);
    try {
      await setConsent('ai_processing', true);
      setNeedConsent(false);
      retryRef.current?.();
    } catch (err) {
      setNeedConsent(false);
      setNotice(errorMessage(err, t, locale));
    } finally {
      setAccepting(false);
    }
  }

  const removeError = remove.isError ? errorMessage(remove.error, t, locale) : null;
  const sendError = send.isError && !consentNeeded(send.error) ? (aiErrorKey(send.error) ? t(aiErrorKey(send.error)!) : errorMessage(send.error, t, locale)) : null;
  const items = messages.data?.items ?? [];

  return (
    <Screen edges={['bottom']} padded={false}>
      <Stack.Screen
        options={{
          title: t('ai.title'),
          headerTitle: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ai.pickModel', { model: model?.label ?? t('ai.noModelLabel') })}
              onPress={() => router.push('/ai/settings')}
              style={[styles.pill, { backgroundColor: colors.primarySoft }]}
            >
              <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }} numberOfLines={1}>
                {model?.label ?? t('ai.noModelLabel')}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.primary} />
            </Pressable>
          ),
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
            ListEmptyComponent={
              messages.isLoading || send.isPending ? (
                <ActivityIndicator />
              ) : (
                <View style={{ gap: spacing.md }}>
                  <Text variant="display" accessibilityRole="header">
                    {t('ai.ask')}
                  </Text>
                  <Text muted>{t('ai.askHint')}</Text>
                  {([1, 2, 3, 4] as const).map((n) => (
                    <Pressable
                      key={n}
                      accessibilityRole="button"
                      onPress={() => setDraft(t(`ai.suggestion.${n}` as const))}
                      style={({ pressed }) => [styles.suggestion, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <View style={[styles.sugIcon, { backgroundColor: colors.primarySoft }]}>
                        <Ionicons name="bulb-outline" size={20} color={colors.primary} />
                      </View>
                      <Text style={{ flex: 1 }}>{t(`ai.suggestion.${n}` as const)}</Text>
                    </Pressable>
                  ))}
                </View>
              )
            }
            renderItem={({ item }) => <Bubble m={item} />}
            ListFooterComponent={
              <View style={{ gap: spacing.sm }}>
                {send.isPending ? (
                  <Text variant="small" muted accessibilityLiveRegion="polite">
                    {t('ai.thinking')}
                  </Text>
                ) : null}
                {notice ? <Text variant="small" muted>{notice}</Text> : null}
                <ActionCards
                  actions={actionsQ.data?.items ?? []}
                  onNeedConsent={(retry) => {
                    retryRef.current = retry;
                    setNeedConsent(true);
                  }}
                />
                {sendError ?? removeError ? (
                  <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                    {sendError ?? removeError}
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
          <View accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t('ai.mic.soon')} style={[styles.mic, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="mic-outline" size={20} color={colors.textMuted} />
          </View>
        </View>
      </KeyboardAvoidingView>
      <ConsentSheet kind={needConsent ? 'ai_processing' : null} busy={accepting} onAccept={() => void acceptConsent()} onRefuse={() => setNeedConsent(false)} />
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
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, minHeight: TOUCH, borderRadius: radius.pill, maxWidth: 220 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + 12, padding: spacing.md, borderRadius: radius.lg },
  sugIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mic: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 140, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
