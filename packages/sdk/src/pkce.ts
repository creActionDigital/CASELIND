/** PKCE (RFC 7636), S256 only, with the Web Crypto API (browsers, React Native with a polyfill, Node 20+). */

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomBase64Url = (byteLength: number): string => toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));

/** 43 to 128 unreserved characters; 48 random bytes give 64. */
export const generateCodeVerifier = (byteLength = 48): string => randomBase64Url(byteLength);

/** `BASE64URL(SHA256(ASCII(verifier)))`, 43 characters. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/** Opaque anti-CSRF value (the API requires 8 to 500 characters). */
export const generateState = (): string => randomBase64Url(16);
