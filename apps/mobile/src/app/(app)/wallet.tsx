import { useI18n } from '../../i18n';
import { EmptyState, Screen } from '../../ui';

/** Wallet : aucun solde ni devise inventés ; affichés quand le backend les fournira. */
export default function Wallet() {
  const { t } = useI18n();
  return (
    <Screen edges={['bottom']}>
      <EmptyState icon="wallet-outline" title={t('wallet.emptyTitle')} body={t('wallet.emptyBody')} />
    </Screen>
  );
}
