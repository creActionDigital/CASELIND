import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { fetchCampaigns, sendCampaign } from '../../../../loyalty/api';
import { Card, Loading, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Campagnes aux clients qui ont accepté les offres, et historique (jamais la liste des personnes). */
export default function Campaigns() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const q = useQuery({ queryKey: ['seller', orgId, 'campaigns'], queryFn: () => fetchCampaigns(orgId) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendCampaign(orgId, { title: title.trim(), body: body.trim() }),
    onSuccess: (c) => {
      setInfo(t('campaign.sent', { n: c.recipients }));
      setTitle('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['seller', orgId, 'campaigns'] });
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.detail<string>('reason') === 'campaign_rate_limited' ? t('campaign.limit') : sellerErrorMessage(e, t, locale)),
  });
  const ready = title.trim().length > 0 && body.trim().length > 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('campaign.title') }} />
      <View style={{ gap: spacing.md }}>
        <TextField label={t('campaign.subject')} value={title} onChangeText={setTitle} maxLength={80} />
        <TextField label={t('campaign.body')} value={body} onChangeText={setBody} maxLength={300} multiline />
        <Text variant="caption" muted>{t('campaign.hint')}</Text>
        {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
        {info ? <Text variant="small" accessibilityLiveRegion="polite">{info}</Text> : null}
        <Button label={t('campaign.send')} loading={send.isPending} disabled={!ready} onPress={() => { setError(null); setInfo(null); send.mutate(); }} />
        <Text variant="bodyStrong">{t('campaign.history')}</Text>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data?.items.length === 0 ? <Text muted>{t('campaign.empty')}</Text> : null}
        {q.data?.items.map((c) => (
          <Card key={c.id}>
            <Text variant="bodyStrong" numberOfLines={1}>{c.title}</Text>
            <Text variant="small" muted>{t('campaign.historyLine', { n: c.recipients, date: new Date(c.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
