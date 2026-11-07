import { Injectable, Logger } from '@nestjs/common';

export type OtpMessage =
  | {
      kind: 'code';
      channel: 'sms' | 'email';
      destination: string;
      purpose: 'signup' | 'password_reset' | 'identifier_change';
      code: string;
      /** User's language when known (`fr` or `en`; anything else falls back to `fr`). */
      locale?: string;
    }
  | { kind: 'already_registered'; channel: 'sms' | 'email'; destination: string; locale?: string }
  /** Lot 1c: warning to the OLD e-mail after the account identifier was changed (never carries the new one). */
  | { kind: 'identifier_changed'; channel: 'email'; destination: string; locale?: string };

/**
 * Delivery port for one-time codes and account notices.
 * Real adapters live in ./otp/ (Brevo e-mail, WhatsApp Cloud API, see ADR-018) and are chosen per
 * channel by the RoutingOtpSender; production startup is refused with the console provider.
 */
export abstract class OtpSender {
  abstract send(message: OtpMessage): Promise<void>;
}

/** Development only: writes codes to the server log instead of sending them. */
@Injectable()
export class ConsoleOtpSender extends OtpSender {
  private readonly logger = new Logger('OtpConsole');

  async send(message: OtpMessage): Promise<void> {
    if (message.kind === 'code') {
      this.logger.warn(
        `[DEV ONLY] ${message.purpose} code for ${message.channel}:${message.destination} -> ${message.code}`,
      );
    } else if (message.kind === 'identifier_changed') {
      this.logger.warn(`[DEV ONLY] "identifier changed" notice for ${message.channel}:${message.destination}`);
    } else {
      this.logger.warn(`[DEV ONLY] "already registered" notice for ${message.channel}:${message.destination}`);
    }
  }
}
