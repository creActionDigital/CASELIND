import { OtpSender, type OtpMessage } from '../otp-sender.js';
import { type FetchLike, OTP_HTTP_TIMEOUT_MS, postJson } from './otp-delivery.js';

export interface BrevoOptions {
  apiKey: string;
  from: string;
  fromName?: string;
  /** Code validity shown in the message. */
  ttlSeconds: number;
  fetch?: FetchLike;
  timeoutMs?: number;
}

type Lang = 'fr' | 'en';
const langOf = (locale?: string): Lang => (locale?.toLowerCase().startsWith('en') ? 'en' : 'fr');

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo transactional e-mail adapter (HTTPS API, native fetch). Phone messages are not its job. */
export class BrevoEmailOtpSender extends OtpSender {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: BrevoOptions) {
    super();
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async send(message: OtpMessage): Promise<void> {
    if (message.channel !== 'email') return;
    const lang = langOf(message.locale);
    const minutes = Math.max(1, Math.round(this.options.ttlSeconds / 60));
    const content = message.kind === 'code'
        ? codeContent(lang, message.code, minutes)
        : message.kind === 'identifier_changed'
          ? identifierChangedContent(lang)
          : noticeContent(lang);
    await postJson(
      'brevo',
      this.fetchImpl,
      BREVO_URL,
      { 'api-key': this.options.apiKey },
      {
        sender: { email: this.options.from, name: this.options.fromName ?? 'CASELIND' },
        to: [{ email: message.destination }],
        subject: content.subject,
        textContent: content.text,
        htmlContent: `<!doctype html><html><body style="font-family:sans-serif;color:#111">${content.html}</body></html>`,
      },
      this.options.timeoutMs ?? OTP_HTTP_TIMEOUT_MS,
    );
  }
}

function codeContent(lang: Lang, code: string, minutes: number) {
  if (lang === 'en') {
    return {
      subject: `${code} is your CASELIND code`,
      text: `Your CASELIND verification code is ${code}. It is valid for ${minutes} minutes. Never share it with anyone.`,
      html: `<p>Your CASELIND verification code is</p><p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p><p>It is valid for ${minutes} minutes. Never share it with anyone.</p>`,
    };
  }
  return {
    subject: `${code} est votre code CASELIND`,
    text: `Votre code de vérification CASELIND est ${code}. Il est valable ${minutes} minutes. Ne le communiquez à personne.`,
    html: `<p>Votre code de vérification CASELIND est</p><p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p><p>Il est valable ${minutes} minutes. Ne le communiquez à personne.</p>`,
  };
}

function noticeContent(lang: Lang) {
  if (lang === 'en') {
    const text =
      'A sign-up was attempted with this address, which already has a CASELIND account. Sign in, or reset your password if needed.';
    return { subject: 'CASELIND account notice', text, html: `<p>${text}</p>` };
  }
  const text =
    'Une inscription a été tentée avec cette adresse, qui possède déjà un compte CASELIND. Connectez-vous, ou réinitialisez votre mot de passe si besoin.';
  return { subject: 'Information sur votre compte CASELIND', text, html: `<p>${text}</p>` };
}

function identifierChangedContent(lang: Lang) {
  if (lang === 'en') {
    const text =
      'The sign-in identifier of your CASELIND account was changed and this address is no longer linked to it. If this was not you, reset your password immediately.';
    return { subject: 'Your CASELIND sign-in identifier was changed', text, html: `<p>${text}</p>` };
  }
  const text =
    "L'identifiant de connexion de votre compte CASELIND a été modifié et cette adresse n'y est plus liée. Si ce n'était pas vous, réinitialisez immédiatement votre mot de passe.";
  return { subject: 'Votre identifiant CASELIND a été modifié', text, html: `<p>${text}</p>` };
}
