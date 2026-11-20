import type { OrderReturn } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { fetchDisputes, returnKeys } from '../../../returns/api';
import { AdminActions } from '../../../returns/AdminActions';
import { ReturnCard } from '../../../returns/ui';
import { Chips, PagedList } from '../../../seller/ui';
import { EmptyState } from '../../../ui';

type Tab = 'disputed' | 'resolved';

/** Litiges de commande escaladés par les acheteurs (rôles admin et support) : décision remboursement, partiel ou refus. */
export default function AdminDisputes() {
  const { t } = useI18n();
  const { me } = useAuth();
  const allowed = !!me && (me.roles.includes('admin') || me.roles.includes('support'));
  const [tab, setTab] = useState<Tab>('disputed');
  const q = useInfiniteQuery({
    queryKey: [...returnKeys.disputes, tab],
    queryFn: ({ pageParam }) => fetchDisputes(tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });
  const title = <Stack.Screen options={{ title: t('returns.admin.title') }} />;
  if (!allowed) return <>{title}<EmptyState icon="lock-closed-outline" title={t('returns.admin.forbidden')} /></>;
  return (
    <>
      {title}
      <PagedList<OrderReturn>
        query={q}
        keyExtractor={(r) => r.id}
        header={<Chips options={[{ value: 'disputed', label: t('returns.admin.open') }, { value: 'resolved', label: t('returns.admin.done') }]} value={tab} onChange={setTab} />}
        empty={{ icon: 'shield-checkmark-outline', title: t('returns.admin.empty') }}
        renderItem={({ item }) => (
          <ReturnCard r={item} showOrder>
            <AdminActions r={item} />
          </ReturnCard>
        )}
      />
    </>
  );
}
