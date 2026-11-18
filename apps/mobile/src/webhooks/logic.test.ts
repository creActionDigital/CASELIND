import type { Webhook, WebhookDelivery } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { buildWebhook, canManageWebhooks, checkUrl, hookState, hostOf, latestDeliveries, toggleEvent, urlErrorOf } from './logic';

describe('droits', () => {
  it('propriétaire seulement', () => {
    expect(canManageWebhooks('owner')).toBe(true);
    for (const r of ['admin', 'manager', 'finance', 'sales', 'employee'] as const) expect(canManageWebhooks(r)).toBe(false);
    expect(canManageWebhooks(undefined)).toBe(false);
  });
});

describe('checkUrl', () => {
  it.each([
    ['', 'empty'],
    ['pas une url', 'invalid'],
    ['http://exemple.com/h', 'https'],
    ['https://u:p@exemple.com/h', 'credentials'],
    ['https://exemple.com:8080/h', 'port'],
    ['https://localhost/h', 'host'],
    ['https://intranet/h', 'host'],
    ['https://127.0.0.1/h', 'host'],
    ['https://[::1]/h', 'host'],
    ['https://imprimante.local/h', 'host'],
  ])('refuse %s', (text, error) => expect(checkUrl(text)).toEqual({ error }));
  it('accepte https public, 443 et 8443, en retirant les espaces', () => {
    expect(checkUrl('  https://hooks.exemple.com/in?x=1 ')).toEqual({ ok: 'https://hooks.exemple.com/in?x=1' });
    expect(checkUrl('https://hooks.exemple.com:8443/in')).toEqual({ ok: 'https://hooks.exemple.com:8443/in' });
    expect(checkUrl('https://hooks.exemple.com:443/in')).toEqual({ ok: 'https://hooks.exemple.com:443/in' });
  });
});

describe('événements et formulaire', () => {
  it('garde l’ordre de la liste blanche', () => {
    expect(toggleEvent([], 'pos.sale_created')).toEqual(['pos.sale_created']);
    expect(toggleEvent(['pos.sale_created'], 'order.created')).toEqual(['order.created', 'pos.sale_created']);
    expect(toggleEvent(['order.created', 'pos.sale_created'], 'order.created')).toEqual(['pos.sale_created']);
  });
  it('exige une URL valide puis au moins un événement', () => {
    expect(buildWebhook('https://a.exemple.com/h', [])).toEqual({ error: 'events' });
    expect(buildWebhook('http://a.exemple.com/h', ['order.created'])).toEqual({ error: 'https' });
    expect(buildWebhook(' https://a.exemple.com/h ', ['order.created'])).toEqual({ ok: { url: 'https://a.exemple.com/h', events: ['order.created'] } });
  });
});

describe('réponses du serveur', () => {
  it('traduit les motifs url_*', () => {
    const d = (m: string) => [{ path: 'url', message: m }];
    expect(urlErrorOf(d('url_scheme'))).toBe('https');
    expect(urlErrorOf(d('url_private_address'))).toBe('host');
    expect(urlErrorOf(d('url_port'))).toBe('port');
    expect(urlErrorOf(d('url_userinfo'))).toBe('credentials');
    expect(urlErrorOf(d('url_invalid'))).toBe('invalid');
    expect(urlErrorOf([{ path: 'events', message: 'x' }])).toBeNull();
    expect(urlErrorOf(undefined)).toBeNull();
  });
  it('état d’un webhook', () => {
    const h = (p: Partial<Webhook>) => ({ active: true, disabledAt: null, failureCount: 0, ...p });
    expect(hookState(h({}))).toBe('ok');
    expect(hookState(h({ failureCount: 2 }))).toBe('failing');
    expect(hookState(h({ active: false }))).toBe('paused');
    expect(hookState(h({ active: false, disabledAt: '2026-11-18T10:00:00.000Z' }))).toBe('disabled');
  });
  it('n’affiche que l’hôte et les 10 dernières livraisons', () => {
    expect(hostOf('https://hooks.exemple.com/in?token=abc')).toBe('hooks.exemple.com');
    expect(hostOf('n/a')).toBe('n/a');
    const items = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }) as WebhookDelivery);
    expect(latestDeliveries(items)).toHaveLength(10);
    expect(latestDeliveries(items)[0]!.id).toBe('0');
  });
});
