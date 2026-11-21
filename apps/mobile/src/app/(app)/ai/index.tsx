import { AI_MESSAGE_MAX_CHARS, type AiModelCard } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { aiKeys, createAiConversation, fetchAiConversations, fetchAiModels, fetchAiSettings, updateAiSettings } from '../../../ai/api';
import { effectiveModel, needsDataNotice, titleFrom } from '../../../ai/logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { FadeInView } from '../../../ui/premium/FadeInView';
import { PressableScale } from '../../../ui/premium/PressableScale';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, TOUCH, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, ErrorState, IconButton, Screen, Text } from '../../../ui';

const ASSISTANTS = [
  { id: 'purchase', icon: 'cart-outline' },
  { id: 'compare', icon: 'git-compare-outline' },
  { id: 'seller', icon: 'storefront-outline' },
  { id: 'pro', icon: 'briefcase-outline' },
  { id: 'finance', icon: 'wallet-outline' },
] as const;

/** Assistant IA : accueil (modèles réels, historique, outils à venir) et barre de message. */
export default function AiHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [draft, setDraft] = useState('');
  const list = useQuery({ queryKey: aiKeys.conversations, queryFn: fetchAiConversations });
  const models = useQuery({ queryKey: aiKeys.models, queryFn: fetchAiModels });
  const settings = useQuery({ queryKey: aiKeys.settings, queryFn: fetchAiSettings });

  const open = (id: string, q?: string) => router.push({ pathname: '/ai/[id]', params: q ? { id, q } : { id } });
  const create = useMutation({
    mutationFn: (question?: string) => createAiConversation(question ? titleFrom(question) : undefined).then((c) => ({ c, question })),
    onSuccess: ({ c, question }) => {
      void qc.invalidateQueries({ queryKey: aiKeys.conversations });
      setDraft('');
      open(c.id, question);
    },
  });
  const save = useMutation({
    mutationFn: updateAiSettings,
    onSuccess: (s) => qc.setQueryData(aiKeys.settings, s),
  });

  const cards = models.data?.items ?? [];
  const current = settings.data ? effectiveModel(cards, settings.data, models.data?.defaultModelId ?? null) : undefined;
  const items = list.data?.items ?? [];
  const first = me?.displayName.trim().split(/\s+/)[0];

  function choose(card: AiModelCard) {
    if (!settings.data) return;
    if (needsDataNotice(card, settings.data)) router.push('/ai/settings');
    else save.mutate({ modelId: card.id });
  }

  function submit() {
    const q = draft.trim();
    if (q && !create.isPending) create.mutate(q);
  }

  const header = (
    <Stack.Screen
      options={{
        title: t('ai.title'),
        headerRight: () => <IconButton icon="settings-outline" label={t('ai.settings')} onPress={() => router.push('/ai/settings')} />,
      }}
    />
  );

  if (list.isError) {
    return (
      <Screen>
        {header}
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </Screen>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <Screen edges={[]} padded={false}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hello}>
            <Avatar name={me?.displayName ?? '?'} size={48} />
            <View style={{ flex: 1 }}>
              <Text variant="title" accessibilityRole="header" numberOfLines={1}>
                {first ? t('ai.hello', { name: first }) : t('ai.helloAnon')}
              </Text>
              <Text variant="small" muted>
                {t('ai.subtitle')}
              </Text>
            </View>
          </View>

          <Text variant="bodyStrong" accessibilityRole="header">
            {t('ai.models')}
          </Text>
          {models.isSuccess && cards.length === 0 ? (
            <View style={[styles.emptyModels, { backgroundColor: colors.surface }]}>
              <Ionicons name="sparkles-outline" size={22} color={colors.textMuted} />
              <Text variant="small" muted style={{ flex: 1 }}>
                {t('ai.noModelsHome')}
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modelRow} style={styles.bleed}>
              {cards.map((m) => {
                const selected = current?.id === m.id;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={m.label}
                    onPress={() => choose(m)}
                    style={[styles.model, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <View style={[styles.modelIcon, { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name="sparkles" size={20} color={colors.primary} />
                    </View>
                    <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={2}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <Text variant="bodyStrong" accessibilityRole="header">{t('md.ai.assistants')}</Text>
          <Text variant="small" muted>{t('md.ai.assistantHint')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modelRow} style={styles.bleed}>
            {ASSISTANTS.map((a, i) => (
              <FadeInView key={a.id} index={i}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`md.ai.a.${a.id}` as MessageKey)}. ${t(`md.ai.a.${a.id}Desc` as MessageKey)}`}
                  onPress={() => !create.isPending && create.mutate(t(`md.ai.a.${a.id}Q` as MessageKey))}
                  style={[styles.agent, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.modelIcon, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name={a.icon} size={20} color={colors.primary} />
                  </View>
                  <Text style={{ fontWeight: '600' }} numberOfLines={2}>{t(`md.ai.a.${a.id}` as MessageKey)}</Text>
                  <Text variant="caption" muted numberOfLines={3}>{t(`md.ai.a.${a.id}Desc` as MessageKey)}</Text>
                </PressableScale>
              </FadeInView>
            ))}
          </ScrollView>

          <View style={[styles.history, { backgroundColor: colors.surface }]}>
            <Text variant="heading">{t('ai.history')}</Text>
            <Text variant="small" muted>
              {items.length === 0 ? t('ai.historyEmpty') : t('ai.historyCount', { n: items.length })}
            </Text>
            <View style={styles.startRow}>
              <Button label={t('ai.start')} onPress={() => create.mutate(undefined)} loading={create.isPending} />
            </View>
            {create.isError ? <Text color={colors.danger}>{errorMessage(create.error, t, locale)}</Text> : null}
          </View>
          {items.slice(0, 5).map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.title}
              onPress={() => open(c.id)}
              style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{c.title}</Text>
                <Text variant="caption" muted>
                  {new Date(c.updatedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}

          <Text variant="bodyStrong" accessibilityRole="header">
            {t('ai.tools')}
          </Text>
          <View style={styles.tools}>
            {([['image-outline', 'ai.tool.image'], ['globe-outline', 'ai.tool.web'], ['mic-outline', 'ai.tool.voice']] as const).map(([icon, key]) => (
              <View
                key={key}
                accessible
                accessibilityState={{ disabled: true }}
                accessibilityLabel={`${t(key)}. ${t('common.soon')}`}
                style={[styles.tool, { backgroundColor: colors.surface, opacity: 0.6 }]}
              >
                <Ionicons name={icon} size={22} color={colors.textMuted} />
                <Text variant="caption" numberOfLines={2}>
                  {t(key)}
                </Text>
                <Text variant="caption" muted>
                  {t('common.soon')}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="small" muted>{t('md.ai.unavailable')}</Text>
          <Text variant="small" muted>{t('md.ai.credits')}</Text>
          <Text variant="small" muted>
            {t('ai.privacyNote')}
          </Text>
        </ScrollView>
        <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('ai.placeholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('ai.placeholder')}
            maxLength={AI_MESSAGE_MAX_CHARS}
            returnKeyType="send"
            onSubmitEditing={submit}
            style={[styles.input, typography.body, { color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ai.send')}
            accessibilityState={{ disabled: !draft.trim() }}
            disabled={!draft.trim()}
            onPress={submit}
            style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: draft.trim() ? 1 : 0.4 }]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
          </Pressable>
          <View
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={t('ai.mic.soon')}
            style={[styles.sendBtn, { backgroundColor: colors.surfaceAlt, opacity: 0.6 }]}
          >
            <Ionicons name="mic-outline" size={20} color={colors.textMuted} />
          </View>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  hello: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bleed: { marginHorizontal: -spacing.lg },
  modelRow: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  model: { width: 112, minHeight: 104, borderRadius: radius.xl, borderWidth: 1.5, padding: spacing.md, gap: spacing.sm },
  agent: { width: 168, minHeight: 148, borderRadius: radius.xl, borderWidth: 1.5, padding: spacing.md, gap: spacing.xs },
  modelIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyModels: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg },
  history: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.xs },
  startRow: { flexDirection: 'row', marginTop: spacing.sm },
  row: { minHeight: TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  tools: { flexDirection: 'row', gap: spacing.sm },
  tool: { flex: 1, minHeight: 96, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH },
  sendBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
});
