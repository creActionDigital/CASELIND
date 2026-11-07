import { Logger } from '@nestjs/common';
import { OtpSender, type OtpMessage } from '../otp-sender.js';
import { maskDestination } from './mask.js';

/**
 * Chooses the adapter by channel. A delivery failure is logged (masked recipient, never the code)
 * and counted, but never thrown: the API still answers 202 (anti-enumeration) and the user can resend.
 */
export class RoutingOtpSender extends OtpSender {
  private readonly logger: Pick<Logger, 'error'> = new Logger('OtpDelivery');
  /** Failed deliveries since startup, per channel; also written in every failure log line. */
  readonly failures = { email: 0, sms: 0 };

  constructor(private readonly routes: { email: OtpSender; sms: OtpSender }) {
    super();
  }

  async send(message: OtpMessage): Promise<void> {
    try {
      await this.routes[message.channel].send(message);
    } catch (err) {
      this.failures[message.channel] += 1;
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `otp delivery failed channel=${message.channel} kind=${message.kind} to=${maskDestination(message.destination)} ` +
          `reason="${reason}" failures_${message.channel}=${this.failures[message.channel]}`,
      );
    }
  }
}
