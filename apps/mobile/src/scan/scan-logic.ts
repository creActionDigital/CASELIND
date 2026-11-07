/** Aiguillage d'un contenu scanné ou collé (fonction pure). Formats : QR marchand 6B, connexion web 1c, profil CASELIND. */

export type ScanTarget =
  | { kind: 'merchant'; payload: string }
  | { kind: 'web_login'; payload: string }
  | { kind: 'profile'; handle: string }
  | { kind: 'unknown' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-zA-Z0-9_.]{3,30}$/;
/** `CLQ1.<orgId>.<qrId>.<montant>.<devise>.<expiration>.<signature>` */
const MERCHANT_PARTS = 7;
const WEB_LOGIN_PREFIX = 'caselind-qr1';
const PROFILE_RE = /^caselind:\/\/\/?u\/([^/?#\s]+)\/?$/i;

export function classifyScan(raw: string): ScanTarget {
  const s = raw.trim();
  if (s.length < 10 || s.length > 400) return { kind: 'unknown' };

  if (s.startsWith('CLQ1.')) {
    const p = s.split('.');
    return p.length === MERCHANT_PARTS && UUID.test(p[1]!) && UUID.test(p[2]!) && p[6]!.length > 0
      ? { kind: 'merchant', payload: s }
      : { kind: 'unknown' };
  }

  if (s.startsWith(`${WEB_LOGIN_PREFIX}:`)) {
    const p = s.split(':');
    return p.length === 3 && p[1] && p[2] ? { kind: 'web_login', payload: s } : { kind: 'unknown' };
  }

  const m = PROFILE_RE.exec(s);
  if (m) {
    let handle = m[1]!;
    try {
      handle = decodeURIComponent(handle);
    } catch {
      return { kind: 'unknown' };
    }
    handle = handle.replace(/^@/, '');
    return HANDLE.test(handle) ? { kind: 'profile', handle: handle.toLowerCase() } : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

/** Destination d'un contenu reconnu (`null` : « Code non reconnu »). */
export type ScanRoute =
  | { pathname: '/pay'; params: { payload: string } }
  | { pathname: '/security/qr-approve'; params: { payload: string } }
  | { pathname: '/u/[handle]'; params: { handle: string } };

export function scanRoute(target: ScanTarget): ScanRoute | null {
  switch (target.kind) {
    case 'merchant':
      return { pathname: '/pay', params: { payload: target.payload } };
    case 'web_login':
      return { pathname: '/security/qr-approve', params: { payload: target.payload } };
    case 'profile':
      return { pathname: '/u/[handle]', params: { handle: target.handle } };
    default:
      return null;
  }
}

/** Contenu du QR de profil : `caselind://u/<handle>` (reconnu par `classifyScan`). */
export function buildProfileQr(handle: string): string {
  return `caselind://u/${encodeURIComponent(handle.trim().replace(/^@/, '').toLowerCase())}`;
}
