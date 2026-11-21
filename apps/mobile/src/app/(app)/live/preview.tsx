import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { DEMO_LIVE } from '../../../hub/live/demo-data';
import { LiveScreen } from '../../../hub/live/LiveScreen';
import type { LiveComment, LiveSession } from '../../../hub/live/types';
import { useI18n } from '../../../i18n';
import { safeBack } from '../../../lib/back-target';

/** Aperçu du design du live : données locales de démonstration, aucun appel réseau, messages jamais envoyés. */
export default function LivePreview() {
  const router = useRouter();
  const { t } = useI18n();
  const [session, setSession] = useState<LiveSession>(DEMO_LIVE);
  const send = (text: string) => {
    const c: LiveComment = { id: `local-${Date.now()}`, user: t('live.you'), text };
    setSession((s) => ({ ...s, comments: [...s.comments.slice(-3), c] }));
  };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LiveScreen
        session={session}
        banner={t('live.demoBanner')}
        onBack={() => safeBack(router, '/hub')}
        onClose={() => safeBack(router, '/hub')}
        onSearch={() => router.push('/search')}
        onSelectTab={() => safeBack(router, '/hub')}
        onSend={send}
      />
    </>
  );
}
