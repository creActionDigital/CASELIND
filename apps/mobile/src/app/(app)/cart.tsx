import { useI18n } from '../../i18n';
import { EmptyState, Screen } from '../../ui';

export default function Cart() {
  const { t } = useI18n();
  return (
    <Screen edges={['bottom']}>
      <EmptyState icon="cart-outline" title={t('cart.emptyTitle')} body={t('cart.emptyBody')} />
    </Screen>
  );
}
