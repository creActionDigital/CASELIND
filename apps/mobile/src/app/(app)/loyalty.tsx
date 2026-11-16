import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Switch, View } from 'react-native';
import { useI18n } from '../../i18n';
import { fetchMyLoyalty, setMarketingConsent } from '../../loyalty/api';
import { Card, Loading } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { ErrorState, Screen, Text } from '../../ui';

/** Mes points par boutique (simple compteur) et consentement aux offres des boutiques. */
export default function MyLoyalty() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'loyalty'], queryFn: fetchMyLoyalty });
  const consent = useMutation({ mutationFn: setMarketingConsent, onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'loyalty'] }) });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('loyalty.title') }} />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ flex: 1 }}>{t('loyalty.consent')}</Text>
            <Switch
              accessibilityLabel={t('loyalty.consent')}
              value={q.data.marketingConsent}
              disabled={consent.isPending}
              onValueChange={(v) => consent.mutate(v)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <Text variant="caption" muted>{t('loyalty.consentHint')}</Text>
          {q.data.items.length === 0 ? <Text muted>{t('loyalty.empty')}</Text> : null}
          {q.data.items.map((i) => (
            <Card key={i.orgId}>
              <Text variant="bodyStrong">{i.orgName}</Text>
              <Text>{t('loyalty.points', { n: i.points })}</Text>
              {i.enabled && i.rewardText ? <Text variant="small" muted>{i.rewardText}</Text> : null}
            </Card>
          ))}
          <Text variant="caption" muted>{t('loyalty.note')}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
