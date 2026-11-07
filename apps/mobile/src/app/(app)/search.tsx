import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button, EmptyState, Screen, TextField } from '../../ui';

export default function Search() {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <Screen edges={['bottom']}>
      <TextField label={t('search.placeholder')} value={q} onChangeText={setQ} returnKeyType="search" />
      {q.trim() ? (
        <Button
          label={t('shop.searchIn', { q: q.trim() })}
          onPress={() => router.push({ pathname: '/shop', params: { q: q.trim() } })}
        />
      ) : null}
      <EmptyState icon="search-outline" title={t('search.emptyTitle')} body={t('search.emptyBody')} />
    </Screen>
  );
}
