import { createUploadResponseSchema, mediaMimeSchema, type MediaMime } from '@caselind/contracts';
import { api } from '../auth/auth-context';
import { ApiRequestError } from '../lib/api';
import { absoluteUrl } from '../lib/config';

const IMAGE_MIMES: MediaMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Type MIME image accepté d'après le type déclaré ou l'extension ; jpeg par défaut. */
export function imageMime(declared: string | null | undefined, uri: string): MediaMime {
  const parsed = mediaMimeSchema.safeParse(declared === 'image/jpg' ? 'image/jpeg' : declared);
  if (parsed.success && IMAGE_MIMES.includes(parsed.data)) return parsed.data;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export type UploadPurpose = 'message' | 'story' | 'product' | 'kyc_document' | 'listing' | 'avatar' | 'org_logo' | 'org_banner' | 'org_gallery' | 'delivery_proof' | 'health_result' | 'digital_file';

/** Annonce (POST /media/uploads) puis envoie les octets (PUT avec X-Upload-Token). Renvoie l'id de l'asset. */
export async function uploadImage(uri: string, mime: MediaMime, purpose: UploadPurpose): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return uploadBody(blob, blob.size, mime, purpose);
}

/** Document de messagerie : même envoi, avec le nom d'origine (nettoyé côté serveur). */
export async function uploadDocument(uri: string, mime: MediaMime, fileName: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return uploadBody(blob, blob.size, mime, 'message', fileName);
}

/** Même envoi pour des octets déjà en mémoire (ex. signature PNG tracée à l'écran) : le Uint8Array part tel quel comme corps. */
export const uploadBytes = (bytes: Uint8Array, mime: MediaMime, purpose: UploadPurpose): Promise<string> => uploadBody(bytes, bytes.byteLength, mime, purpose);

async function uploadBody(body: Blob | Uint8Array, sizeBytes: number, mime: MediaMime, purpose: UploadPurpose, fileName?: string): Promise<string> {
  const announce = await api.request('/media/uploads', {
    method: 'POST',
    body: { purpose, mime, sizeBytes, fileName },
    schema: createUploadResponseSchema,
  });

  const put = (token: string) =>
    fetch(absoluteUrl(announce.uploadUrl), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'X-Upload-Token': announce.uploadToken, 'Content-Type': mime },
      body: body as BodyInit,
    });
  let token = api.getAccessToken() ?? (await api.restore());
  let res: Response;
  try {
    res = await put(token);
    if (res.status === 401) {
      token = await api.restore();
      res = await put(token);
    }
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    throw new ApiRequestError(0, 'network_error', 'Network request failed');
  }
  if (!res.ok) {
    let code = res.status === 413 ? 'payload_too_large' : 'unknown_error';
    try {
      const j = (await res.json()) as { error?: { code?: string } };
      if (j.error?.code) code = j.error.code;
    } catch {
      /* corps non JSON */
    }
    throw new ApiRequestError(res.status, code, `HTTP ${res.status}`);
  }
  return announce.assetId;
}

export const uploadMessageImage = (uri: string, mime: MediaMime) => uploadImage(uri, mime, 'message');
export const uploadAvatarImage = (uri: string, mime: MediaMime) => uploadImage(uri, mime, 'avatar');
export const uploadProductImage = (uri: string, mime: MediaMime) => uploadImage(uri, mime, 'product');
