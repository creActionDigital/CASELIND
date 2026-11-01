import { Injectable, Logger } from '@nestjs/common';

export type OtpMessage =
  | { kind: 'code'; channel: 'sms' | 'email'; destination: string; purpose: 'signup' | 'password_reset'; code: string }
  | { kind: 'already_registered'; channel: 'sms' | 'email'; destination: string };

/**
 * Delivery port for one-time codes and account notices.
 * Real SMS/e-mail/WhatsApp providers implement this; none is contracted yet
 * (see docs/BACKLOG.md › Décisions), so production startup is refused with the console provider.
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
    } else {
      this.logger.warn(`[DEV ONLY] "already registered" notice for ${message.channel}:${message.destination}`);
    }
  }
}
