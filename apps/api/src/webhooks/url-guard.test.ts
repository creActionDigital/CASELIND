import { describe, expect, it } from 'vitest';
import { isForbiddenAddress, resolvedAddressesAllowed, type UrlRejection, validateWebhookUrl } from './url-guard.js';

const prod = { production: true };
const dev = { production: false };

const rejected: [string, string, UrlRejection][] = [
  ['not a url', 'nope', 'invalid'],
  ['empty host', 'https://', 'invalid'],
  ['http in prod', 'http://example.com/hook', 'scheme'],
  ['http on a public host, dev', 'http://example.com/hook', 'scheme'],
  ['ftp', 'ftp://example.com/', 'scheme'],
  ['javascript', 'javascript:alert(1)', 'invalid'],
  ['userinfo', 'https://user:pw@example.com/', 'userinfo'],
  ['user only', 'https://user@example.com/', 'userinfo'],
  ['userinfo trick', 'https://example.com@127.0.0.1/', 'userinfo'],
  ['port 80', 'https://example.com:80/', 'port'],
  ['port 22', 'https://example.com:22/', 'port'],
  ['port 3000', 'https://example.com:3000/', 'port'],
  ['loopback', 'https://127.0.0.1/', 'private_address'],
  ['loopback 127.1.2.3', 'https://127.1.2.3/', 'private_address'],
  ['decimal ipv4', 'https://2130706433/', 'private_address'],
  ['octal ipv4', 'https://0177.0.0.1/', 'private_address'],
  ['hex ipv4', 'https://0x7f.0.0.1/', 'private_address'],
  ['hex whole ipv4', 'https://0x7f000001/', 'private_address'],
  ['short ipv4', 'https://127.1/', 'private_address'],
  ['10/8', 'https://10.0.0.5/', 'private_address'],
  ['172.16/12', 'https://172.16.0.1/', 'private_address'],
  ['172.31', 'https://172.31.255.255/', 'private_address'],
  ['192.168/16', 'https://192.168.1.1/', 'private_address'],
  ['metadata', 'https://169.254.169.254/latest/meta-data', 'private_address'],
  ['CGNAT', 'https://100.64.0.1/', 'private_address'],
  ['0.0.0.0', 'https://0.0.0.0/', 'private_address'],
  ['0 shorthand', 'https://0/', 'private_address'],
  ['broadcast', 'https://255.255.255.255/', 'private_address'],
  ['ipv6 loopback', 'https://[::1]/', 'private_address'],
  ['ipv6 unspecified', 'https://[::]/', 'private_address'],
  ['ipv6 mapped loopback', 'https://[::ffff:127.0.0.1]/', 'private_address'],
  ['ipv6 mapped hex', 'https://[::ffff:7f00:1]/', 'private_address'],
  ['ipv6 mapped metadata', 'https://[::ffff:169.254.169.254]/', 'private_address'],
  ['ipv6 ula', 'https://[fd12:3456::1]/', 'private_address'],
  ['ipv6 fc00', 'https://[fc00::1]/', 'private_address'],
  ['ipv6 link-local', 'https://[fe80::1]/', 'private_address'],
  ['nat64 loopback', 'https://[64:ff9b::7f00:1]/', 'private_address'],
  ['6to4 loopback', 'https://[2002:7f00:1::1]/', 'private_address'],
  ['localhost', 'https://localhost/', 'host'],
  ['localhost trailing dot', 'https://localhost./', 'host'],
  ['LOCALHOST upper', 'https://LOCALHOST/', 'host'],
  ['sub.localhost', 'https://app.localhost/', 'host'],
  ['.local', 'https://printer.local/', 'host'],
  ['.internal', 'https://metadata.google.internal/', 'host'],
  ['single label', 'https://intranet/', 'host'],
  ['http localhost in prod', 'http://localhost/hook', 'scheme'],
  ['http 127.0.0.1 in dev (only the name localhost is allowed)', 'http://127.0.0.1:8080/', 'scheme'],
  ['https localhost dev', 'https://localhost/', 'host'],
];

describe('validateWebhookUrl', () => {
  it.each(rejected)('refuses %s (%s)', (_label, raw, reason) => {
    const opts = _label.includes('dev') ? dev : prod;
    expect(validateWebhookUrl(raw, opts)).toEqual({ ok: false, reason });
  });

  it('accepts public https URLs, port 443 and 8443, and drops the fragment', () => {
    for (const raw of ['https://example.com/hook', 'https://hooks.example.co.uk:8443/a?b=1', 'https://8.8.8.8/x', 'https://[2606:4700:4700::1111]/', 'https://EXAMPLE.com:443/']) {
      expect(validateWebhookUrl(raw, prod).ok, raw).toBe(true);
    }
    const r = validateWebhookUrl('https://example.com/h#frag', prod);
    expect(r.ok && r.url.hash).toBe('');
  });

  it('accepts http://localhost with any port outside production only', () => {
    const r = validateWebhookUrl('http://localhost:4010/hook', dev);
    expect(r).toMatchObject({ ok: true, devLoopback: true, host: 'localhost' });
    expect(validateWebhookUrl('http://localhost:4010/hook', prod)).toEqual({ ok: false, reason: 'scheme' });
  });

  it('keeps the parsed host as the one that will be contacted (deceptive hosts)', () => {
    // Backslash is a path separator for special schemes: the host is example.com.
    const a = validateWebhookUrl('https://example.com\\@127.0.0.1/', prod);
    expect(a.ok && a.host).toBe('example.com');
    // Looks private but is a name: refused at send time by the DNS check, not here.
    expect(validateWebhookUrl('https://127.0.0.1.nip.io/', prod).ok).toBe(true);
    expect(validateWebhookUrl('https://localtest.me/', prod).ok).toBe(true);
  });
});

describe('isForbiddenAddress', () => {
  const forbidden = ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '169.254.1.1', '100.100.100.100', '0.0.0.0', '224.0.0.1', '240.0.0.1', '198.18.0.1', '::1', '::', '::ffff:10.0.0.1', '::ffff:c0a8:1', 'fe80::1', 'fd00::1', 'ff02::1', '2001:db8::1', 'not-an-ip', ''];
  const allowed = ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '169.253.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];

  it.each(forbidden)('forbids %s', (ip) => expect(isForbiddenAddress(ip)).toBe(true));
  it.each(allowed)('allows %s', (ip) => expect(isForbiddenAddress(ip)).toBe(false));
});

describe('resolvedAddressesAllowed (anti DNS rebinding)', () => {
  it('needs every address public', () => {
    expect(resolvedAddressesAllowed(['93.184.216.34'], false)).toBe(true);
    expect(resolvedAddressesAllowed(['93.184.216.34', '2606:2800:220:1::1'], false)).toBe(true);
    expect(resolvedAddressesAllowed(['93.184.216.34', '127.0.0.1'], false)).toBe(false);
    expect(resolvedAddressesAllowed(['::ffff:127.0.0.1'], false)).toBe(false);
    expect(resolvedAddressesAllowed([], false)).toBe(false);
  });
  it('lets the dev loopback through', () => {
    expect(resolvedAddressesAllowed(['127.0.0.1'], true)).toBe(true);
    expect(resolvedAddressesAllowed([], true)).toBe(false);
  });
});
