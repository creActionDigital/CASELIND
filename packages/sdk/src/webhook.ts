import type { MiniAppEvent } from '@caselind/contracts';

/** Why a delivery was refused. `bad_signature` also covers a wrong secret; never reveal which to the caller of your endpoint. */
export class CaselindWebhookError extends Error {
  constructor(
    readonly reason: 'missing_header' | 'stale_timestamp' | 'bad_signature' | 'bad_body',
    message: string,
  ) {
    super(message);
    this.name = 'CaselindWebhookError';
  }
}

interface Base<E extends string, D> {
  id: string;
  event: E;
  createdAt: string;
  appId: string;
  /** `sub` is the user's identifier for YOUR app only (stable, never the global CASELIND id): key your own data on it. */
  data: { sub: string } & D;
}
type Money = { paymentRequestId: string; clientRef: string; amountMinor: number; currency: string };

/** Events CASELIND sends to your webhook (those declared in your manifest, plus `ping` from the portal test button). */
export type MiniAppWebhookEvent =
  | Base<'authorization.granted', { scopes: string[] }>
  | Base<'authorization.revoked', { reason: string }>
  | Base<'payment.confirmed', Money>
  | Base<'payment.declined', Money>
  | Base<'user.data_deletion_requested', { deletionScheduledFor: string }>
  | Base<'ping', { ping: boolean }>;

const KNOWN: readonly (MiniAppEvent | 'ping')[] = ['authorization.granted', 'authorization.revoked', 'payment.confirmed', 'payment.declined', 'user.data_deletion_requested', 'ping'];

/** Parses a raw body into a typed event (no signature check: use `verifyWebhook` on anything received over HTTP). */
export function parseWebhookEvent(rawBody: string): MiniAppWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new CaselindWebhookError('bad_body', 'the body is not JSON');
  }
  const e = json as Partial<MiniAppWebhookEvent> | null;
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.appId !== 'string' || !KNOWN.includes(e.event as MiniAppEvent) || !e.data || typeof e.data.sub !== 'string') {
    throw new CaselindWebhookError('bad_body', 'not a CASELIND event');
  }
  return e as MiniAppWebhookEvent;
}

const headerOf = (headers: Headers | Record<string, string | string[] | undefined>, name: string): string | undefined => {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
};

/** Constant-time comparison of two strings (length differences are not hidden: signatures have a fixed length). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 hex of `${timestamp}.${body}` with WebCrypto (Node 20+, browsers, edge runtimes). */
export async function signWebhook(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks a delivery and returns the typed event. Pass the RAW body (before any JSON parsing), the request headers and your
 * webhook secret. Refuses a missing header, a timestamp older (or newer) than `toleranceSeconds` (default 300: replay
 * protection) and a signature that does not match (constant-time comparison). Respond 2xx only after this succeeded.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  secret: string,
  toleranceSeconds = 300,
  now: () => number = Date.now,
): Promise<MiniAppWebhookEvent> {
  const timestamp = headerOf(headers, 'x-caselind-timestamp');
  const signature = headerOf(headers, 'x-caselind-signature');
  if (!timestamp || !signature) throw new CaselindWebhookError('missing_header', 'X-Caselind-Timestamp and X-Caselind-Signature are required');
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now() / 1000 - ts) > toleranceSeconds) throw new CaselindWebhookError('stale_timestamp', 'timestamp outside the tolerance');
  const expected = await signWebhook(secret, timestamp, rawBody);
  if (!safeEqual(expected, signature.trim().toLowerCase())) throw new CaselindWebhookError('bad_signature', 'signature mismatch');
  return parseWebhookEvent(rawBody);
}
