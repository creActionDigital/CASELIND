import { CONSENT_VERSIONS, type ConsentKind, type UserConsent } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { alertConfirm } from '../../lib/confirm';
import { fetchConsentHistory, fetchConsents, privacyKeys, setConsent } from '../../privacy/api';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { ErrorState, Screen, Text } from '../../ui';

/** Mes consentements : une ligne par type, interrupteur (retrait immédiat, avec confirmation), version du texte, historique. */
export default function Consents() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: privacyKeys.consents, queryFn: fetchConsents });
  const history = useQuery({ queryKey: privacyKeys.history, queryFn: fetchConsentHistory });
  const change = useMutation({
    mutationFn: (v: { kind: ConsentKind; granted: boolean }) => setConsent(v.kind, v.granted),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: privacyKeys.consents });
      void qc.invalidateQueries({ queryKey: privacyKeys.history });
    },
  });
  const date = (d: string) => new Date(d).toLocaleDateString(locale);
  const label = (k: ConsentKind) => t(`consents.kind.${k}` as MessageKey);

  const toggle = (c: UserConsent, granted: boolean) => {
    if (granted) change.mutate({ kind: c.kind, granted });
    else
      alertConfirm(t('consents.withdrawTitle'), `${label(c.kind)}\n${t('consents.withdrawBody')}`, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('consents.withdraw'), style: 'destructive', onPress: () => change.mutate({ kind: c.kind, granted }) },
      ]);
  };

  if (list.isPending) return <Screen edges={['bottom']}><ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /></Screen>;
  if (list.isError) return <Screen edges={['bottom']}><ErrorState error={list.error} onRetry={() => list.refetch()} /></Screen>;

  return (
    <Screen edges={['bottom']}>
      <Text muted style={{ marginBottom: spacing.md }}>{t('consents.intro')}</Text>
      {change.isError ? <ErrorState error={change.error} /> : null}
      <View style={{ gap: spacing.md }}>
        {list.data.items.map((c) => (
          <View key={c.kind} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.head}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{label(c.kind)}</Text>
              <Switch accessibilityRole="switch" accessibilityState={{ checked: c.granted }}
                accessibilityLabel={label(c.kind)}
                value={c.granted}
                disabled={change.isPending}
                onValueChange={(v) => toggle(c, v)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
            <Text variant="small">{t(`consents.text.${c.kind}` as MessageKey)}</Text>
            <Text variant="small" muted>
              {t('consents.version', { v: c.version ?? CONSENT_VERSIONS[c.kind] })}
              {' · '}
              {c.updatedAt ? t('consents.since', { date: date(c.updatedAt) }) : t('consents.never')}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>{t('consents.history')}</Text>
      {history.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : history.data.items.length === 0 ? (
        <Text muted>{t('consents.historyEmpty')}</Text>
      ) : (
        <View style={{ gap: spacing.xs }}>
          {history.data.items.map((e) => (
            <Text key={e.id} variant="small">
              {`${date(e.createdAt)} · ${label(e.kind)} · ${e.granted ? t('consents.granted') : t('consents.withdrawn')} (v${e.version})`}
            </Text>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
