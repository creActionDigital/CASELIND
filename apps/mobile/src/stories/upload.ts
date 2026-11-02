import { createUploadResponseSchema, type MediaMime } from '@caselind/contracts';
import { api } from '../auth/auth-context';
import { ApiRequestError } from '../lib/api';
import { absoluteUrl } from '../lib/config';

/** Annonce (purpose story) puis envoi des octets (PUT avec X-Upload-Token). Renvoie l'id de l'asset. */
export async function uploadStoryImage(uri: string, mime: MediaMime): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const announce = await api.request('/media/uploads', {
    method: 'POST',
    body: { purpose: 'story', mime, sizeBytes: blob.size },
    schema: createUploadResponseSchema,
  });
  const put = (token: string) =>
    fetch(absoluteUrl(announce.uploadUrl), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'X-Upload-Token': announce.uploadToken, 'Content-Type': mime },
      body: blob,
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
