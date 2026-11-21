import type { AdCampaign } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { alertConfirm } from '../lib/confirm';
import { errorMessage } from '../lib/errors';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { campaignAction } from './api';

/** Pause, reprise et arrêt d'une campagne (l'arrêt demande confirmation et rembourse le budget non dépensé). */
export function CampaignActions({ campaign }: { campaign: AdCampaign }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'stop') => campaignAction(campaign.id, action),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ad-campaigns'] });
      void qc.invalidateQueries({ queryKey: ['ad-stats', campaign.id] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => {
      const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      const key = `mon.err.${reason}` as MessageKey;
      setError(reason && t(key) !== key ? t(key) : errorMessage(e, t, locale));
    },
  });
  const s = campaign.status;
  return (
    <View style={styles.row}>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {s === 'approved' ? <Button variant="secondary" label={t('mon.ads.pause')} loading={act.isPending} onPress={() => act.mutate('pause')} /> : null}
      {s === 'paused' ? <Button variant="secondary" label={t('mon.ads.resume')} loading={act.isPending} onPress={() => act.mutate('resume')} /> : null}
      {s === 'pending' || s === 'approved' || s === 'paused' ? (
        <Button
          variant="danger"
          label={t('mon.ads.stop')}
          disabled={act.isPending}
          onPress={() =>
            alertConfirm(t('mon.ads.stop'), t('mon.ads.stop.confirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('mon.ads.stop'), style: 'destructive', onPress: () => act.mutate('stop') },
            ])
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
