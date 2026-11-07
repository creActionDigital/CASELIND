import { type Env, resolveOtpProviders } from '../../config/env.js';
import { ConsoleOtpSender, type OtpSender } from '../otp-sender.js';
import { BrevoEmailOtpSender } from './brevo-email-otp.sender.js';
import type { FetchLike } from './otp-delivery.js';
import { RoutingOtpSender } from './routing-otp.sender.js';
import { WhatsAppOtpSender } from './whatsapp-otp.sender.js';

/** Builds the per-channel router from validated env (loadEnv already checked the required keys). */
export function createOtpSender(env: Env, fetchImpl?: FetchLike): RoutingOtpSender {
  const providers = resolveOtpProviders(env);
  const consoleSender = new ConsoleOtpSender();
  const email: OtpSender =
    providers.email === 'brevo'
      ? new BrevoEmailOtpSender({
          apiKey: env.BREVO_API_KEY ?? '',
          from: env.OTP_EMAIL_FROM ?? '',
          fromName: env.OTP_EMAIL_FROM_NAME,
          ttlSeconds: env.OTP_TTL_SECONDS,
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        })
      : consoleSender;
  const sms: OtpSender =
    providers.phone === 'whatsapp'
      ? new WhatsAppOtpSender({
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
          accessToken: env.WHATSAPP_ACCESS_TOKEN ?? '',
          template: env.WHATSAPP_OTP_TEMPLATE ?? '',
          templateLang: env.WHATSAPP_TEMPLATE_LANG,
          graphVersion: env.WHATSAPP_GRAPH_VERSION,
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        })
      : consoleSender;
  return new RoutingOtpSender({ email, sms });
}
