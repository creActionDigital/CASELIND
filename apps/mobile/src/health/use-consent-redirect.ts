import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { isConsentRequired } from './logic';

/** Sans consentement santé (403 consent_required), renvoie vers l'écran de consentement au lieu d'une erreur. */
export function useConsentRedirect(error: unknown): void {
  const router = useRouter();
  const needed = isConsentRequired(error);
  useEffect(() => {
    if (needed) router.replace('/health');
  }, [needed, router]);
}
