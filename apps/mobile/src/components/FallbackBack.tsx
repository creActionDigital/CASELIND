import { usePathname, useRouter } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';
import { useI18n } from '../i18n';
import { parentRoute } from '../lib/back-target';

/**
 * `headerLeft` des piles : toujours un bouton retour (renvoyer undefined masquerait celui par défaut). Avec un historique
 * dans la pile, retour normal ; sinon (premier écran d'une pile imbriquée, lien, notification, rechargement web), retour dans
 * la pile parente s'il y en a une, sinon vers l'écran parent : jamais d'impasse.
 */
export function fallbackHeaderLeft(props: { canGoBack?: boolean; tintColor?: unknown }) {
  return <FallbackBack tintColor={props.tintColor as string | undefined} />;
}

function FallbackBack(props: Pick<ComponentProps<typeof HeaderBackButton>, 'tintColor'>) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <HeaderBackButton
      {...props}
      label={t('common.back')}
      accessibilityLabel={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(parentRoute(pathname) as never))}
    />
  );
}
