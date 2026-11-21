import { Platform, Share } from 'react-native';

/**
 * Partage qui répond toujours quelque chose : feuille de partage du téléphone ; sur le web, `Share.share` ne fait rien,
 * donc partage du navigateur s'il existe, sinon copie dans le presse-papiers puis `copiedLabel` en alerte.
 */
export async function shareMessage(content: { message: string; title?: string }, copiedLabel: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await Share.share(content).catch(() => undefined);
    return;
  }
  const nav = globalThis.navigator as (Navigator & { share?: (d: { text: string; title?: string }) => Promise<void> }) | undefined;
  if (nav?.share) {
    await nav.share({ text: content.message, title: content.title }).catch(() => undefined);
    return;
  }
  try {
    await nav?.clipboard?.writeText(content.message);
    // eslint-disable-next-line no-alert
    globalThis.alert?.(copiedLabel);
  } catch {
    /* presse-papiers refusé : rien de plus à faire */
  }
}
