import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { spacing } from '../theme/tokens';
import { Button } from '../ui';
import { fetchCommunity, publishCommunity, unpublishCommunity } from './communities-api';

/** Propriétaire d'un groupe : le publier dans les communautés, ou le retirer. Description et étiquettes : plus tard. */
export function PublishCommunity({ conversationId }: { conversationId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ['community', conversationId],
    queryFn: () => fetchCommunity(conversationId).then(() => true).catch((e: unknown) => (e instanceof ApiRequestError && e.status === 404 ? false : Promise.reject(e))),
  });
  const toggle = useMutation({
    mutationFn: async () => {
      if (state.data) await unpublishCommunity(conversationId);
      else await publishCommunity(conversationId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['community', conversationId] });
      void qc.invalidateQueries({ queryKey: ['communities'] });
    },
  });
  if (state.data === undefined) return null;
  return (
    <Button
      variant="secondary"
      label={state.data ? t('group.unpublish') : t('group.publish')}
      loading={toggle.isPending}
      onPress={() => toggle.mutate()}
      style={{ marginTop: spacing.md }}
    />
  );
}
