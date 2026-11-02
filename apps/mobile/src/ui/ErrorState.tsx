import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { ApiRequestError } from '../lib/api';
import { EmptyState } from './EmptyState';

interface Props {
  error: unknown;
  onRetry?: () => void;
}

/** État d'erreur réseau / serveur / accès refusé, avec nouvel essai. */
export function ErrorState({ error, onRetry }: Props) {
  const { t, locale } = useI18n();
  const denied = error instanceof ApiRequestError && (error.status === 403 || error.status === 404);
  return (
    <EmptyState
      icon={denied ? 'lock-closed-outline' : 'cloud-offline-outline'}
      title={t('error.title')}
      body={errorMessage(error, t, locale)}
      actionLabel={onRetry && !denied ? t('common.retry') : undefined}
      onAction={onRetry}
    />
  );
}
