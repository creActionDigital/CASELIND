import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { FormError } from '../../../auth/FormError';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { qrApprove, qrPreview } from '../../../security/api';
import { qrErrorMessage } from '../../../security/errors';
import { Card } from '../../../security/ui';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, Screen, Text } from '../../../ui';

/** Approbation d'une connexion web : aperçu de l'appareil demandeur, puis Autoriser ou Refuser (ouvert par le scanner). */
export default function QrApprove() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ payload?: string }>();
  const payload = typeof params.payload === 'string' ? params.payload : '';
  const [done, setDone] = useState<'approved' | 'refused' | null>(null);

  const preview = useQuery({
    queryKey: ['qr-preview', payload],
    queryFn: () => qrPreview(payload),
    enabled: payload.length >= 10,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  });
  const approve = useMutation({
    mutationFn: () => qrApprove(payload),
    onSuccess: () => setDone('approved'),
  });

  const title = <Stack.Screen options={{ title: t('security.qr.title') }} />;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (payload.length < 10) {
    return (
      <Screen edges={['bottom']}>
        {title}
        <EmptyState icon="qr-code-outline" title={t('security.qr.invalid')} actionLabel={t('common.close')} onAction={close} />
      </Screen>
    );
  }
  if (done) {
    return (
      <Screen edges={['bottom']}>
        {title}
        <EmptyState
          icon={done === 'approved' ? 'checkmark-circle-outline' : 'close-circle-outline'}
          title={t(done === 'approved' ? 'security.qr.approved' : 'security.qr.refused')}
          body={t(done === 'approved' ? 'security.qr.approvedBody' : 'security.qr.refusedBody')}
          actionLabel={t('common.close')}
          onAction={close}
        />
      </Screen>
    );
  }
  if (preview.isPending) {
    return (
      <Screen edges={['bottom']}>
        {title}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (preview.isError) {
    const retryable = preview.error instanceof ApiRequestError && (preview.error.status === 0 || preview.error.status >= 500);
    return (
      <Screen edges={['bottom']}>
        {title}
        <EmptyState
          icon="qr-code-outline"
          title={t('error.title')}
          body={qrErrorMessage(preview.error, t, locale)}
          actionLabel={retryable ? t('common.retry') : t('common.close')}
          onAction={retryable ? () => void preview.refetch() : close}
        />
      </Screen>
    );
  }

  const d = preview.data.device;
  return (
    <Screen edges={['bottom']}>
      {title}
      <View style={{ gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Text variant="heading" accessibilityRole="header">
          {t('security.qr.heading')}
        </Text>
        <Card>
          <Text variant="bodyStrong">{d.name ?? t('security.qr.unknownBrowser')}</Text>
          <Text variant="small" muted>
            {d.platform}
            {d.ip ? ` · ${d.ip}` : ''}
          </Text>
          <Text variant="small" muted>
            {t('security.qr.requestedAt', { date: new Date(preview.data.requestedAt).toLocaleString(locale) })}
          </Text>
        </Card>
        <Card tone="warn">
          <Text variant="small" color={colors.danger}>
            {t('security.qr.warn')}
          </Text>
        </Card>
        <FormError message={approve.isError ? qrErrorMessage(approve.error, t, locale) : null} />
        <Button label={t('security.qr.allow')} loading={approve.isPending} onPress={() => approve.mutate()} />
        <Button variant="secondary" label={t('security.qr.deny')} onPress={() => setDone('refused')} />
      </View>
    </Screen>
  );
}
