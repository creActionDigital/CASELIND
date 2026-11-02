import { describe, expect, it } from 'vitest';
import { handleFromDisplayName } from '../auth/auth.service.js';
import { OtpService } from '../auth/otp.service.js';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://localhost/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_PEPPER: 'b'.repeat(32),
  MEDIA_SIGNING_SECRET: 'c'.repeat(32),
};

describe('environment validation', () => {
  it('applies safe defaults', () => {
    const env = loadEnv(base);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('refuses weak secrets', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses the console OTP provider in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/OTP_PROVIDER/);
  });
});

describe('handleFromDisplayName', () => {
  it.each([
    ['Amani Kabila', /^amani_kabila_\d{4}$/],
    ['Élodie Mbuyi-Ngoy', /^elodie_mbuyi_ngoy_\d{4}$/],
    ['李', /^user_\d{4}$/],
    ['A very long display name that goes on', /^[a-z_]{1,20}_\d{4}$/],
  ])('%s', (name, pattern) => {
    const handle = handleFromDisplayName(name);
    expect(handle).toMatch(pattern);
    expect(handle).toMatch(/^[a-zA-Z0-9_.]{3,30}$/);
  });
});

describe('OtpService.generateCode', () => {
  it('always returns 6 digits', () => {
    for (let i = 0; i < 500; i++) expect(OtpService.generateCode()).toMatch(/^\d{6}$/);
  });
});
