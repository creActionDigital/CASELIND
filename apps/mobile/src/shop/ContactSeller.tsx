import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { startChatErrorKey } from '../messaging/api';
import { qk } from '../messaging/keys';
import { openDirect } from '../social/api';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';

/**
 * « Contacter le vendeur » : ouvre la conversation directe avec le membre d'assistance de l'organisation
 * (`contactUserId`, fourni par l'API). Masqué quand l'API n'en donne pas (aucun membre, ou blocage).
 * Les réglages `contactRequestsFrom` du membre s'appliquent : le refus est expliqué, pas masqué.
 */
export function ContactSeller({ contactUserId }: { contactUserId: string | null | undefined }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => openDirect(contactUserId!),
    onMutate: () => setNotice(null),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
      router.push({ pathname: '/messages/[conversationId]', params: { conversationId: c.id } });
    },
    onError: (e) => {
      const key = startChatErrorKey(e);
      setNotice(key ? t(key) : errorMessage(e, t, locale));
    },
  });
  if (!contactUserId) return null;
  return (
    <>
      <Button variant="secondary" label={t('shop.contactSeller')} loading={open.isPending} onPress={() => open.mutate()} />
      {notice ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
    </>
  );
}
