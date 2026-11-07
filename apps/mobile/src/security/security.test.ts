import { describe, expect, it } from 'vitest';
import { classifyLogin } from './login-response';
import { ageOn, isAdult, maskIdNumber, parseBirthDate, validateKycLevel1, type KycFormInput } from './kyc-logic';
import { backupCodesText, formatSecret, isOtpauthUri, looksLikeBackupCode, rawSecret } from './totp';

const NOW = new Date('2026-11-07T10:00:00Z');
const pair = {
  accessToken: 'a',
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  refreshToken: 'r',
  refreshTokenExpiresAt: '2030-02-01T00:00:00.000Z',
  sessionId: '3f2b8c1e-9a4d-4b6e-8f0a-1c2d3e4f5a6b',
};

describe('totp', () => {
  it('formats the secret in groups of 4', () => {
    expect(formatSecret('jbswy3dpehpk3pxp')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(formatSecret('JBSWY3D')).toBe('JBSW Y3D');
    expect(rawSecret('jbsw y3dp-ehpk')).toBe('JBSWY3DPEHPK');
  });
  it('recognises otpauth links and backup codes', () => {
    expect(isOtpauthUri('otpauth://totp/CASELIND:a?secret=X')).toBe(true);
    expect(isOtpauthUri('https://evil.test')).toBe(false);
    expect(looksLikeBackupCode('abcde-fghij')).toBe(true);
    expect(looksLikeBackupCode('123456')).toBe(false);
    expect(backupCodesText(['a', 'b'])).toBe('a\nb');
  });
});

describe('login response union', () => {
  it('reads a token pair', () => {
    expect(classifyLogin(pair)).toEqual({ kind: 'tokens', pair });
  });
  it('reads a two-factor challenge', () => {
    const challengeId = '3f2b8c1e-9a4d-4b6e-8f0a-1c2d3e4f5a6b';
    expect(classifyLogin({ twoFactorRequired: true, challengeId })).toEqual({ kind: 'twoFactor', challengeId });
  });
  it('rejects anything else', () => {
    expect(classifyLogin({ twoFactorRequired: false })).toBeNull();
    expect(classifyLogin({})).toBeNull();
  });
});

describe('age', () => {
  it('parses both date formats and rejects impossible dates', () => {
    expect(parseBirthDate('1990-02-28')).toBe('1990-02-28');
    expect(parseBirthDate('28/02/1990')).toBe('1990-02-28');
    expect(parseBirthDate('1990-02-30')).toBeNull();
    expect(parseBirthDate('hier')).toBeNull();
  });
  it('requires 18 full years, birthday included', () => {
    expect(isAdult('2008-11-07', NOW)).toBe(true);
    expect(isAdult('2008-11-08', NOW)).toBe(false);
    expect(ageOn('2030-01-01', NOW)).toBeNull();
    expect(isAdult('1990-01-01', NOW)).toBe(true);
  });
});

describe('KYC form', () => {
  const ok: KycFormInput = {
    legalName: 'Amani Kabila',
    birthDate: '1995-05-05',
    idType: 'passport',
    idNumber: 'OB123456',
    city: 'Goma',
    hasDocument: true,
    hasSelfie: true,
  };
  it('accepts a complete form', () => {
    expect(validateKycLevel1(ok, NOW)).toEqual({});
  });
  it('flags each missing or out-of-bounds field', () => {
    const bad = validateKycLevel1(
      { ...ok, legalName: 'A', birthDate: '2015-01-01', idType: null, idNumber: '12', city: ' ', hasDocument: false, hasSelfie: false },
      NOW,
    );
    expect(Object.keys(bad).sort()).toEqual(['city', 'document', 'idNumber', 'idType', 'legalName', 'selfie', 'underage']);
    expect(validateKycLevel1({ ...ok, birthDate: '31/02/2000' }, NOW)).toEqual({ birthDate: true });
  });
});

describe('id number masking', () => {
  it('only shows the last 4 characters', () => {
    expect(maskIdNumber('OB123456')).toBe('•••• 3456');
    expect(maskIdNumber('1234')).toBe('•••• 1234');
    expect(maskIdNumber('OB123456')).not.toContain('OB12');
    expect(maskIdNumber(null)).toBe('');
  });
});
