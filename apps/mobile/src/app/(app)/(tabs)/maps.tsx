import { useI18n } from '../../../i18n';
import { EmptyState, Screen } from '../../../ui';

export default function Maps() {
  const { t } = useI18n();
  return (
    <Screen edges={[]}>
      <EmptyState icon="map-outline" title={t('maps.emptyTitle')} body={t('maps.emptyBody')} />
    </Screen>
  );
}
