import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { OtpSender, type OtpMessage } from '../otp-sender.js';
import { BREVO_URL, BrevoEmailOtpSender } from './brevo-email-otp.sender.js';
import { maskDestination } from './mask.js';
import { createOtpSender } from './otp-sender.factory.js';
import { RoutingOtpSender } from './routing-otp.sender.js';
import { WhatsAppOtpSender } from './whatsapp-otp.sender.js';

const ok = () => new Response('{}', { status: 201 });
const code = (over: Partial<Extract<OtpMessage, { kind: 'code' }>> = {}): OtpMessage => ({
  kind: 'code',
  channel: 'email',
  destination: 'amani@example.cd',
  purpose: 'signup',
  code: '123456',
  ...over,
});
const call = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls[0] as unknown as [string, RequestInit];
const brevo = (fetch: any, timeoutMs?: number) =>
  new BrevoEmailOtpSender({
    apiKey: 'KEY',
    from: 'no-reply@caselind.app',
    ttlSeconds: 600,
    fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
const wa = (fetch: any, timeoutMs?: number) =>
  new WhatsAppOtpSender({
    phoneNumberId: '555',
    accessToken: 'TOK',
    template: 'caselind_otp',
    templateLang: 'fr',
    graphVersion: 'v21.0',
    fetch,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
const hangingFetch = () =>
  vi.fn(
    (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(init.signal?.reason));
      }),
  );

describe('BrevoEmailOtpSender', () => {
  it('posts a French transactional e-mail by default', async () => {
    const fetch = vi.fn(async () => ok());
    await brevo(fetch).send(code());
    const [url, init] = call(fetch);
    expect(url).toBe(BREVO_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('KEY');
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: 'no-reply@caselind.app', name: 'CASELIND' });
    expect(body.to).toEqual([{ email: 'amani@example.cd' }]);
    expect(body.subject).toBe('123456 est votre code CASELIND');
    expect(body.textContent).toContain('10 minutes');
    expect(body.htmlContent).toContain('<strong>123456</strong>');
  });

  it('uses English for an English user', async () => {
    const fetch = vi.fn(async () => ok());
    await brevo(fetch).send(code({ locale: 'en' }));
    const body = JSON.parse(call(fetch)[1].body as string);
    expect(body.subject).toBe('123456 is your CASELIND code');
    expect(body.textContent).toContain('valid for 10 minutes');
  });

  it('sends a notice without any code for an existing account', async () => {
    const fetch = vi.fn(async () => ok());
    await brevo(fetch).send({ kind: 'already_registered', channel: 'email', destination: 'a@b.cd' });
    expect(JSON.parse(call(fetch)[1].body as string).textContent).not.toMatch(/\d{6}/);
  });

  it('ignores phone messages and throws on HTTP errors without leaking data', async () => {
    const fetch = vi.fn(async () => new Response('bad amani@example.cd', { status: 401 }));
    await brevo(fetch).send(code({ channel: 'sms', destination: '+243812345678' }));
    expect(fetch).not.toHaveBeenCalled();
    const err = await brevo(fetch).send(code()).catch((e: Error) => e);
    expect((err as Error).message).toBe('brevo: HTTP 401');
  });

  it('gives up after the timeout and does not retry', async () => {
    const fetch = hangingFetch();
    await expect(brevo(fetch, 20).send(code())).rejects.toThrow(/brevo: timeout after 20 ms/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('WhatsAppOtpSender', () => {
  it('posts the authentication template to the Graph API', async () => {
    const fetch = vi.fn(async () => ok());
    await wa(fetch).send(code({ channel: 'sms', destination: '+243812345678' }));
    const [url, init] = call(fetch);
    expect(url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer TOK');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '243812345678',
      type: 'template',
      template: {
        name: 'caselind_otp',
        language: { code: 'fr' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    });
  });

  it('sends nothing for the notice or for e-mail, and times out cleanly', async () => {
    const fetch = vi.fn(async () => ok());
    await wa(fetch).send({ kind: 'already_registered', channel: 'sms', destination: '+243812345678' });
    await wa(fetch).send(code());
    expect(fetch).not.toHaveBeenCalled();
    await expect(wa(hangingFetch(), 20).send(code({ channel: 'sms', destination: '+243812345678' }))).rejects.toThrow(
      /timeout/,
    );
  });
});

describe('RoutingOtpSender', () => {
  class Spy extends OtpSender {
    sent: OtpMessage[] = [];
    fail = false;
    async send(m: OtpMessage) {
      if (this.fail) throw new Error('whatsapp: HTTP 500');
      this.sent.push(m);
    }
  }

  it('routes by channel', async () => {
    const email = new Spy();
    const sms = new Spy();
    const router = new RoutingOtpSender({ email, sms });
    await router.send(code());
    await router.send(code({ channel: 'sms', destination: '+243812345678' }));
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
  });

  it('swallows failures, counts them and logs only a masked recipient', async () => {
    const sms = new Spy();
    sms.fail = true;
    const router = new RoutingOtpSender({ email: new Spy(), sms });
    const lines: string[] = [];
    (router as unknown as { logger: { error: (m: string) => void } }).logger = { error: (m) => lines.push(m) };
    await expect(router.send(code({ channel: 'sms', destination: '+243812345678' }))).resolves.toBeUndefined();
    await router.send(code({ channel: 'sms', destination: '+243812345678' }));
    expect(router.failures.sms).toBe(2);
    expect(lines[1]).toContain('failures_sms=2');
    expect(lines[1]).toContain('to=***678');
    expect(lines.join()).not.toMatch(/123456|243812345678/);
  });
});

describe('maskDestination', () => {
  it('hides most of the recipient', () => {
    expect(maskDestination('amani@example.cd')).toBe('a***@e***.cd');
    expect(maskDestination('+243812345678')).toBe('***678');
  });
});

describe('createOtpSender', () => {
  it('builds real adapters from env and sends through the injected fetch', async () => {
    const fetch = vi.fn(async () => ok());
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      OTP_PEPPER: 'b'.repeat(32),
      MEDIA_SIGNING_SECRET: 'c'.repeat(32),
      OTP_EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'k',
      OTP_EMAIL_FROM: 'a@b.cd',
      OTP_PHONE_PROVIDER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_OTP_TEMPLATE: 'tpl',
    });
    const sender = createOtpSender(env, fetch as any);
    await sender.send(code());
    await sender.send(code({ channel: 'sms', destination: '+243812345678' }));
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      BREVO_URL,
      'https://graph.facebook.com/v21.0/1/messages',
    ]);
  });
});
