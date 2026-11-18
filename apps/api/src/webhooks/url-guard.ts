import { isIP } from 'node:net';

/**
 * Anti-SSRF guard for webhook URLs. Pure (no I/O): the caller resolves DNS and feeds the addresses to
 * `resolvedAddressesAllowed`. The URL is parsed with the WHATWG parser, which already normalises decimal / octal / hex
 * IPv4 hosts ("2130706433", "0177.1", "0x7f.1" -> 127.0.0.1) and IPv6 forms ("[::ffff:127.0.0.1]" -> "[::ffff:7f00:1]"),
 * so every check below runs on the normalised host, the very one the request will use. Everything unknown is refused.
 */
export type UrlRejection = 'invalid' | 'scheme' | 'userinfo' | 'port' | 'host' | 'private_address';

export type GuardedUrl = { ok: true; url: URL; host: string; devLoopback: boolean } | { ok: false; reason: UrlRejection };

const ALLOWED_PORTS = new Set(['', '443', '8443']);
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp', '.private'];

/** True for every IPv4 address that is not a public unicast one. `o` = four octets. */
function forbiddenV4(o: readonly number[]): boolean {
  const [a, b, c] = o as [number, number, number];
  return (
    a === 0 || // "this network", 0.0.0.0
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a === 127 ||
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 literal into eight 16-bit groups, or null when it is not one. Zone ids are refused. */
function groupsOfV6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let s = ip.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1]!.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return null;
    s = s.slice(0, -v4[1]!.length) + ((p[0]! << 8) | p[1]!).toString(16) + ':' + ((p[2]! << 8) | p[3]!).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

const v4OfGroups = (hi: number, lo: number): number[] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** True when `ip` must never be contacted (private, loopback, link-local, CGNAT, metadata, multicast, reserved, or not an IP at all). */
export function isForbiddenAddress(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const kind = isIP(bare);
  if (kind === 4) return forbiddenV4(bare.split('.').map(Number));
  const g = groupsOfV6(bare);
  if (!g) return true; // fail closed
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return forbiddenV4(v4OfGroups(g6, g7)); // IPv4-mapped
    if (g5 === 0) return true; // ::, ::1 and the deprecated IPv4-compatible range
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return forbiddenV4(v4OfGroups(g6, g7)); // NAT64
  if (g0 === 0x2002) return forbiddenV4(v4OfGroups(g1, g2)); // 6to4
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) || // Teredo, documentation
    (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) // discard-only
  );
}

function isLocalName(host: string): boolean {
  return host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

/**
 * Static validation of a webhook URL (no DNS). https only, no credentials, port 443 or 8443, no IP literal in a private
 * range, no local name. `http://localhost[:port]` is accepted outside production only, for tests (`devLoopback`).
 */
export function validateWebhookUrl(raw: string, opts: { production: boolean }): GuardedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return { ok: false, reason: 'invalid' };
  const devLoopback = !opts.production && url.protocol === 'http:' && host === 'localhost';
  if (url.protocol !== 'https:' && !devLoopback) return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  if (!devLoopback && !ALLOWED_PORTS.has(url.port)) return { ok: false, reason: 'port' };
  if (!devLoopback) {
    if (isIP(host)) {
      if (isForbiddenAddress(host)) return { ok: false, reason: 'private_address' };
    } else if (isLocalName(host)) {
      return { ok: false, reason: 'host' };
    }
  }
  url.hash = '';
  return { ok: true, url, host, devLoopback };
}

/** DNS answer check, run at every send (anti-rebinding): every resolved address must be public. */
export function resolvedAddressesAllowed(addresses: readonly string[], devLoopback: boolean): boolean {
  if (addresses.length === 0) return false;
  return devLoopback || addresses.every((a) => !isForbiddenAddress(a));
}
