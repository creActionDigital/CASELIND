import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { REPORT_DETAILS_MAX, type ReportReason } from '@caselind/contracts';
import { api } from '../auth/auth-context';
import { FormError } from '../auth/FormError';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { storyKeys } from '../stories/keys';
import { registerReportListener, type ReportTarget } from './open-report';
import { buildDetails, REPORT_REASONS, reportErrorKey, validateReport } from './validate';

/** Feuille globale de signalement, montée une fois dans `(app)/_layout.tsx` et ouverte par `openReport`. */
export function ReportSheet() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    registerReportListener((tg) => {
      setTarget(tg);
      setReason(null);
      setDetails('');
      setError(null);
      setSent(false);
    });
    return () => registerReportListener(null);
  }, []);

  const send = useMutation({
    mutationFn: (tg: ReportTarget) =>
      api.request('/reports', {
        method: 'POST',
        body: { targetType: tg.targetType, targetId: tg.targetId, reason, details: buildDetails(details) },
      }),
    onSuccess: () => {
      setSent(true);
      qc.invalidateQueries({ queryKey: storyKeys.myReports });
    },
    onError: (err) => {
      const key = reportErrorKey(err);
      setError(key ? t(key) : errorMessage(err, t, locale));
    },
  });

  function submit() {
    if (!target) return;
    const problem = validateReport({ reason, details });
    if (problem) {
      setError(t(problem === 'reason' ? 'report.error.reason' : 'report.error.details'));
      return;
    }
    setError(null);
    send.mutate(target);
  }

  return (
    <SheetModal visible={!!target} onClose={() => setTarget(null)}>
      {sent ? (
        <View style={{ gap: spacing.md }}>
          <View style={[styles.disc, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="checkmark" size={30} color={colors.primary} />
          </View>
          <Text variant="heading" accessibilityRole="header" style={styles.center}>
            {t('report.sentTitle')}
          </Text>
          <Text muted style={styles.center}>
            {t('report.sentBody')}
          </Text>
          <Button label={t('common.close')} onPress={() => setTarget(null)} />
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
          <Text variant="heading" accessibilityRole="header">
            {t('report.title')}
          </Text>
          <Text muted style={{ marginBottom: spacing.sm }}>
            {t('report.subtitle')}
          </Text>
          <View accessibilityRole="radiogroup">
            {REPORT_REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t(`report.reason.${r}`)}
                  onPress={() => setReason(r)}
                  style={styles.row}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.textMuted} />
                  <Text style={{ flex: 1 }}>{t(`report.reason.${r}`)}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={REPORT_DETAILS_MAX}
            placeholder={t('report.details')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('report.details')}
            style={[styles.input, typography.body, { color: colors.text, backgroundColor: colors.surfaceAlt }]}
          />
          <View style={{ marginTop: spacing.md }}>
            <FormError message={error} />
          </View>
          <Button label={t('report.submit')} onPress={submit} loading={send.isPending} />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setTarget(null)} style={{ marginTop: spacing.sm }} />
        </ScrollView>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  input: { minHeight: 88, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, textAlignVertical: 'top' },
  disc: { width: 64, height: 64, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  center: { textAlign: 'center' },
});
