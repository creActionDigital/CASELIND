import { createHmac, timingSafeEqual } from 'node:crypto';

export const UPLOAD_TOKEN_TTL_MS = 15 * 60_000;

function mac(secret: string, assetId: string, ownerId: string, expiresAtMs: number): Buffer {
  return createHmac('sha256', secret).update(`media-upload\n${assetId}\n${ownerId}\n${expiresAtMs}`).digest();
}

/**
 * `<expiresAtMs>.<base64url HMAC-SHA256(assetId, ownerId, expiresAtMs)>`. Stateless: nothing is stored,
 * and the token only works for this asset, this owner and until its expiry.
 */
export function signUploadToken(secret: string, assetId: string, ownerId: string, expiresAt: Date): string {
  const exp = expiresAt.getTime();
  return `${exp}.${mac(secret, assetId, ownerId, exp).toString('base64url')}`;
}

export function verifyUploadToken(
  secret: string,
  token: string | undefined,
  assetId: string,
  ownerId: string,
  now: Date = new Date(),
): boolean {
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp <= now.getTime()) return false;
  const given = Buffer.from(match[2]!, 'base64url');
  const expected = mac(secret, assetId, ownerId, exp);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
