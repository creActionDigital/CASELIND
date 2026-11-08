import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { AiModelCard } from '@caselind/contracts';
import { aiKeys, fetchAiModels, fetchAiSettings, updateAiSettings } from '../../../ai/api';
import { effectiveModel, needsDataNotice } from '../../../ai/logic';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** Choix du modèle, avertissement sur les données et bascule automatique (décision Q9, ADR-022). */
export default function AiSettingsScreen() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const models = useQuery({ queryKey: aiKeys.models, queryFn: fetchAiModels });
  const settings = useQuery({ queryKey: aiKeys.settings, queryFn: fetchAiSettings });
  const [pending, setPending] = useState<AiModelCard | null>(null);
  const save = useMutation({
    mutationFn: updateAiSettings,
    onSuccess: (s) => {
      qc.setQueryData(aiKeys.settings, s);
      setPending(null);
    },
  });

  if (models.isError || settings.isError) {
    return (
      <Screen>
        <ErrorState
          error={models.error ?? settings.error}
          onRetry={() => {
            void models.refetch();
            void settings.refetch();
          }}
        />
      </Screen>
    );
  }
  if (!models.data || !settings.data) return <Screen>{null}</Screen>;

  const items = models.data.items;
  const current = effectiveModel(items, settings.data, models.data.defaultModelId);

  function choose(card: AiModelCard) {
    // Un modèle qui peut entraîner sur les données exige d'abord l'avertissement.
    if (needsDataNotice(card, settings.data!)) setPending(card);
    else save.mutate({ modelId: card.id });
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: t('ai.settings') }} />
      {items.length === 0 ? <EmptyState icon="sparkles-outline" title={t('ai.noModels')} /> : null}

      {pending ? (
        <View style={[styles.notice, { backgroundColor: colors.primarySoft }]}>
          <Text variant="heading">{t('ai.noticeTitle')}</Text>
          <Text>{t('ai.noticeBody')}</Text>
          <Text variant="small" muted>
            {pending.dataPolicy}
          </Text>
          <Button
            label={t('ai.noticeAccept')}
            loading={save.isPending}
            onPress={() => save.mutate({ modelId: pending.id, acknowledgedDataNotice: true })}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setPending(null)} />
        </View>
      ) : null}

      <Text variant="heading" style={styles.section}>
        {t('ai.model')}
      </Text>
      <View style={{ gap: spacing.sm }}>
        {items.map((m) => {
          const selected = current?.id === m.id;
          const trains = m.trainsOnData === true ? 'ai.trains.yes' : m.trainsOnData === false ? 'ai.trains.no' : 'ai.trains.unknown';
          return (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={m.label}
              onPress={() => choose(m)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{m.label}</Text>
                <Text variant="small" muted>
                  {[m.free ? t('ai.free') : t('ai.paid'), m.speed ? t(`ai.speed.${m.speed}` as const) : null].filter(Boolean).join(' · ')}
                </Text>
                <Text variant="small" color={m.trainsOnData === false ? colors.success : colors.textMuted}>
                  {t(trains)}
                </Text>
              </View>
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
                {selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.switchRow, { backgroundColor: colors.surface }]}>
        <Text style={{ flex: 1 }}>{t('ai.fallback')}</Text>
        <Switch
          accessibilityLabel={t('ai.fallback')}
          value={settings.data.allowFallback}
          onValueChange={(v) => save.mutate({ allowFallback: v })}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>
      {save.isError ? <Text color={colors.danger}>{errorMessage(save.error, t, locale)}</Text> : null}
      <Text variant="small" muted style={styles.section}>
        {t('ai.privacyNote')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { minHeight: TOUCH + 16, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1.5 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  notice: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, marginBottom: spacing.lg },
  switchRow: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl },
});
