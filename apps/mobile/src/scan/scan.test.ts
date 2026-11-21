import { describe, expect, it } from 'vitest';
import { buildCreateQr, validateFreeAmount } from './qr-forms';
import { buildProfileQr, classifyScan, scanRoute } from './scan-logic';

const ORG = '11111111-1111-4111-8111-111111111111';
const QR = '22222222-2222-4222-8222-222222222222';
const merchant = `CLQ1.${ORG}.${QR}.1500.USD.1900000000.abcDEF_-123`;

describe('classifyScan', () => {
  it('reconnaît un QR marchand', () => {
    expect(classifyScan(` ${merchant}\n`)).toEqual({ kind: 'merchant', payload: merchant });
    expect(scanRoute(classifyScan(merchant))).toEqual({ pathname: '/pay', params: { payload: merchant } });
  });
  it('refuse un QR marchand mal formé', () => {
    expect(classifyScan(`CLQ1.${ORG}.x.1500.USD.0.sig`).kind).toBe('unknown');
    expect(classifyScan(`CLQ1.${ORG}.${QR}.1500.USD.0`).kind).toBe('unknown');
  });
  it('reconnaît une connexion web', () => {
    const p = 'caselind-qr1:abc123:nonce456';
    expect(scanRoute(classifyScan(p))).toEqual({ pathname: '/security/qr-approve', params: { payload: p } });
    expect(classifyScan('caselind-qr1:abcdefgh').kind).toBe('unknown');
  });
  it('reconnaît un profil', () => {
    expect(classifyScan('caselind://u/Jean.Dupont')).toEqual({ kind: 'profile', handle: 'jean.dupont' });
    expect(classifyScan('caselind://u/@marie_k/')).toEqual({ kind: 'profile', handle: 'marie_k' });
    expect(classifyScan('caselind://u/ab').kind).toBe('unknown');
    expect(classifyScan('caselind://u/bad%20name').kind).toBe('unknown');
  });
  it('renvoie « inconnu » pour le reste', () => {
    for (const s of ['', 'hello world', 'https://example.com/x', 'x'.repeat(500)]) {
      expect(classifyScan(s).kind).toBe('unknown');
      expect(scanRoute(classifyScan(s))).toBeNull();
    }
  });
});

describe('buildProfileQr', () => {
  it('est reconnu par le scanner', () => {
    expect(buildProfileQr('@Marie_K')).toBe('caselind://u/marie_k');
    expect(classifyScan(buildProfileQr('Jean.Dupont'))).toEqual({ kind: 'profile', handle: 'jean.dupont' });
  });
});

describe('montants', () => {
  it('valide le montant libre', () => {
    expect(validateFreeAmount('12,50', 'USD')).toEqual({ minor: 1250 });
    expect(validateFreeAmount('0', 'USD')).toEqual({ issue: 'invalid' });
    expect(validateFreeAmount('1.234', 'USD')).toEqual({ issue: 'invalid' });
    expect(validateFreeAmount('abc', 'CDF')).toEqual({ issue: 'invalid' });
  });
  const base = { currency: 'USD', label: ' Caisse 1 ', expiresInSeconds: 900, singleUse: true };
  it('construit un QR statique ou à montant fixe', () => {
    expect(buildCreateQr({ ...base, mode: 'free', amount: '' })).toEqual({ body: { currency: 'USD', label: 'Caisse 1' } });
    expect(buildCreateQr({ ...base, mode: 'fixed', amount: '5' })).toEqual({
      body: { currency: 'USD', label: 'Caisse 1', amountMinor: 500, expiresInSeconds: 900, singleUse: true },
    });
    expect(buildCreateQr({ ...base, mode: 'fixed', amount: '' })).toEqual({ issue: 'amount' });
    expect(buildCreateQr({ ...base, mode: 'free', amount: '', label: 'x'.repeat(81) })).toEqual({ issue: 'label' });
  });
});

describe('QR payez-moi', () => {
  it('construit puis reconnaît un montant entier avec sa devise', async () => {
    const { buildPayRequestQr, classifyScan, scanRoute } = await import('./scan-logic');
    const raw = buildPayRequestQr('@Awa_K', 2550, 'USD');
    expect(raw).toBe('caselind://pay/awa_k?a=2550&c=USD');
    expect(classifyScan(raw)).toEqual({ kind: 'pay_user', handle: 'awa_k', amountMinor: 2550, currency: 'USD' });
    expect(scanRoute(classifyScan(raw))).toEqual({ pathname: '/wallet/send', params: { to: 'awa_k', amount: '2550', currency: 'USD' } });
  });
  it('refuse montant nul, devise inconnue ou format libre', async () => {
    const { classifyScan } = await import('./scan-logic');
    expect(classifyScan('caselind://pay/awa_k?a=0&c=USD').kind).toBe('unknown');
    expect(classifyScan('caselind://pay/awa_k?a=100&c=EUR').kind).toBe('unknown');
    expect(classifyScan('caselind://pay/awa_k?a=-5&c=USD').kind).toBe('unknown');
  });
});
