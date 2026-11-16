import type { AttachedFile } from '@caselind/contracts';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button } from '../ui';
import { getAuthMediaUri } from './auth-media';

const kb = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Pièces jointes protégées (CV PDF, livraison, leçon) : téléchargées avec le jeton puis ouvertes. Pas d'envoi ici (voir le différé du lot 19m). */
export function FileLinks({ files, label }: { files: readonly AttachedFile[]; label: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (files.length === 0) return null;
  const open = async (f: AttachedFile) => {
    setBusy(f.id);
    try {
      const uri = await getAuthMediaUri(f.contentUrl);
      if (Platform.OS === 'web') window.open(uri, '_blank');
      else await Linking.openURL(uri);
    } catch {
      /* le fichier reste disponible : on peut réessayer */
    } finally {
      setBusy(null);
    }
  };
  return (
    <View>
      {files.map((f, i) => (
        <Button key={f.id} variant="secondary" label={`${label} ${i + 1} · ${f.mime.split('/')[1]} · ${kb(f.sizeBytes)}`} loading={busy === f.id} onPress={() => void open(f)} />
      ))}
    </View>
  );
}
