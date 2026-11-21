import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchProgram, saveProgram } from '../../../../loyalty/api';
import { SELLER_CURRENCIES } from '../../../../seller/money';
import { Chips, Loading, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Programme de fidélité de la boutique : actif, points par unité, devise, texte de récompense. */
export default function SellerLoyalty() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const q = useQuery({ queryKey: ['seller', orgId, 'loyalty'], queryFn: () => fetchProgram(orgId) });
  const [enabled, setEnabled] = useState(false);
  const [ppu, setPpu] = useState('1');
  const [currency, setCurrency] = useState<(typeof SELLER_CURRENCIES)[number]>('USD');
  const [reward, setReward] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setPpu(String(q.data.pointsPerUnit));
    setCurrency(q.data.currency);
    setReward(q.data.rewardText);
  }, [q.data]);
  const n = Number(ppu);
  const valid = /^\d+$/.test(ppu) && n >= 1 && n <= 100;
  const save = useMutation({
    mutationFn: () => saveProgram(orgId, { enabled, pointsPerUnit: n, currency, rewardText: reward.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seller', orgId, 'loyalty'] }),
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('loyalty.seller.title') }} />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="small" muted>{t('loyalty.seller.stats', { members: q.data.members, points: q.data.pointsIssued })}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ flex: 1 }}>{t('loyalty.seller.enabled')}</Text>
            <Switch accessibilityRole="switch" accessibilityState={{ checked: enabled }} accessibilityLabel={t('loyalty.seller.enabled')} value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
          <TextField label={t('loyalty.seller.ppu')} value={ppu} onChangeText={setPpu} keyboardType="number-pad" maxLength={3} error={valid ? null : t('loyalty.seller.invalid')} />
          <Text variant="caption" muted>{t('loyalty.seller.currency')}</Text>
          <Chips scroll={false} options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
          <TextField label={t('loyalty.seller.reward')} value={reward} onChangeText={setReward} maxLength={200} multiline />
          <Text variant="caption" muted>{t('loyalty.seller.note')}</Text>
          {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button label={t('common.save')} loading={save.isPending} disabled={!valid} onPress={() => { setError(null); save.mutate(); }} />
          {save.isSuccess ? <Text variant="small" muted accessibilityLiveRegion="polite">{t('common.saved')}</Text> : null}
        </View>
      ) : null}
    </Screen>
  );
}
