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
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/OTP_EMAIL_PROVIDER[\s\S]*OTP_PHONE_PROVIDER/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_PROVIDER: 'console' })).toThrow(/console OTP provider/);
  });

  const prod = { ...base, NODE_ENV: 'production', OTP_EMAIL_PROVIDER: 'brevo', OTP_PHONE_PROVIDER: 'whatsapp' };

  it('requires the keys of the chosen OTP providers in production', () => {
    expect(() => loadEnv(prod)).toThrow(/BREVO_API_KEY is required[\s\S]*WHATSAPP_ACCESS_TOKEN is required/);
    expect(() => loadEnv(prod)).toThrow(/OTP_EMAIL_FROM[\s\S]*WHATSAPP_PHONE_NUMBER_ID[\s\S]*WHATSAPP_OTP_TEMPLATE/);
  });

  it('accepts configured providers and defaults the template language', () => {
    const env = loadEnv({
      ...prod,
      NODE_ENV: 'development',
      BREVO_API_KEY: 'k',
      OTP_EMAIL_FROM: 'no-reply@caselind.app',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_OTP_TEMPLATE: 'tpl',
    });
    expect(env.WHATSAPP_TEMPLATE_LANG).toBe('fr');
    expect(env.WHATSAPP_GRAPH_VERSION).toBe('v21.0');
  });

  it('refuses console for one channel in production and keeps console as the dev default', () => {
    const keys = { BREVO_API_KEY: 'k', OTP_EMAIL_FROM: 'a@b.cd' };
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_EMAIL_PROVIDER: 'brevo', ...keys })).toThrow(
      /OTP_PHONE_PROVIDER/,
    );
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).OTP_EMAIL_PROVIDER).toBeUndefined();
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
