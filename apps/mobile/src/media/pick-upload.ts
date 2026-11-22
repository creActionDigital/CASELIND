import { isMimeAllowedFor, mediaMimeSchema, type MediaPurpose } from '@caselind/contracts';
import * as DocumentPicker from 'expo-document-picker';
import { uploadFile } from './upload';

/** Ouvre le sélecteur de fichiers puis envoie le fichier. `null` si annulé, `'unsupported'` si le type n'est pas permis pour cet usage. */
export async function pickAndUpload(purpose: 'cv' | 'lesson'): Promise<string | 'unsupported' | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const mime = mediaMimeSchema.safeParse(asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined));
  if (!mime.success || !isMimeAllowedFor(purpose as MediaPurpose, mime.data)) return 'unsupported';
  return uploadFile(asset.uri, mime.data, purpose, asset.name);
}
