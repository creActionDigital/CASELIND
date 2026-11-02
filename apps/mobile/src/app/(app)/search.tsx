import { useState } from 'react';
import { useI18n } from '../../i18n';
import { EmptyState, Screen, TextField } from '../../ui';

export default function Search() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  return (
    <Screen edges={['bottom']}>
      <TextField label={t('search.placeholder')} value={q} onChangeText={setQ} returnKeyType="search" />
      <EmptyState icon="search-outline" title={t('search.emptyTitle')} body={t('search.emptyBody')} />
    </Screen>
  );
}
