import { useCallback, useState, type ReactElement } from 'react';
import { translateMessage } from '../ai/assist-api';
import { consentNeeded, translationTarget } from '../ai/assist-logic';
import { ConsentSheet } from '../ai/ConsentSheet';
import { useI18n } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { setConsent } from '../privacy/api';

export interface TranslationView {
  text: string;
  /** true = the original is shown (the translation stays one tap away). */
  showOriginal: boolean;
}

/**
 * Traduction d'un message à la demande. Sans consentement « translation », une feuille explique ce qui part vers
 * le fournisseur ; accepter enregistre le consentement puis traduit, refuser ne fait rien partir.
 */
export function useMessageTranslation(onError: (message: string) => void): {
  views: ReadonlyMap<string, TranslationView>;
  busyId: string | null;
  request: (messageId: string) => void;
  toggle: (messageId: string) => void;
  sheet: ReactElement;
} {
  const { t, locale } = useI18n();
  const [views, setViews] = useState<Map<string, TranslationView>>(() => new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needConsent, setNeedConsent] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const run = useCallback(
    async (messageId: string) => {
      setBusyId(messageId);
      try {
        const res = await translateMessage(messageId, translationTarget(locale));
        setViews((m) => new Map(m).set(messageId, { text: res.text, showOriginal: false }));
      } catch (err) {
        if (consentNeeded(err) === 'translation') setNeedConsent(messageId);
        else if (err instanceof ApiRequestError && err.detail<string>('reason') === 'message_too_long') onError(t('translate.err.tooLong'));
        else if (err instanceof ApiRequestError && err.detail<string>('reason') === 'nothing_to_translate') onError(t('translate.err.empty'));
        else if (err instanceof ApiRequestError && err.detail<string>('reason') === 'recalled') onError(t('translate.err.recalled'));
        else onError(errorMessage(err, t, locale));
      } finally {
        setBusyId(null);
      }
    },
    [locale, onError, t],
  );

  const request = useCallback(
    (messageId: string) => {
      const known = views.get(messageId);
      if (known) setViews((m) => new Map(m).set(messageId, { ...known, showOriginal: false }));
      else void run(messageId);
    },
    [run, views],
  );

  const toggle = useCallback((messageId: string) => {
    setViews((m) => {
      const v = m.get(messageId);
      return v ? new Map(m).set(messageId, { ...v, showOriginal: !v.showOriginal }) : m;
    });
  }, []);

  async function accept() {
    const id = needConsent;
    if (!id) return;
    setAccepting(true);
    try {
      await setConsent('translation', true);
      setNeedConsent(null);
      await run(id);
    } catch (err) {
      setNeedConsent(null);
      onError(errorMessage(err, t, locale));
    } finally {
      setAccepting(false);
    }
  }

  const sheet = <ConsentSheet kind={needConsent ? 'translation' : null} busy={accepting} onAccept={() => void accept()} onRefuse={() => setNeedConsent(null)} />;
  return { views, busyId, request, toggle, sheet };
}
