import { Platform } from 'react-native';
import { getAuthMediaUri } from '../media/auth-media';

/** Ouvre ou télécharge un fichier protégé : web = téléchargement du navigateur ; natif = feuille d'ouverture/partage. */
export async function openMessageFile(contentUrl: string, mime: string, name: string): Promise<void> {
  const uri = await getAuthMediaUri(contentUrl);
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = uri;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: name });
}
