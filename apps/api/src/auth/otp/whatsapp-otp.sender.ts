import { Logger } from '@nestjs/common';
import { OtpSender, type OtpMessage } from '../otp-sender.js';
import { type FetchLike, OTP_HTTP_TIMEOUT_MS, postJson } from './otp-delivery.js';

export interface WhatsAppOptions {
  phoneNumberId: string;
  accessToken: string;
  /** Name of the approved authentication template. */
  template: string;
  templateLang: string;
  graphVersion: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * WhatsApp Cloud API (Meta) adapter. Codes use an approved *authentication* template (its body and
 * copy-code button both carry the code; the validity text is part of the template). The
 * "already registered" notice has no approved template, so nothing is sent for it.
 */
export class WhatsAppOtpSender extends OtpSender {
  private readonly logger = new Logger('WhatsAppOtp');
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: WhatsAppOptions) {
    super();
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async send(message: OtpMessage): Promise<void> {
    if (message.channel !== 'sms') return;
    if (message.kind !== 'code') {
      this.logger.debug('no WhatsApp template for the "already registered" notice; nothing sent');
      return;
    }
    const o = this.options;
    await postJson(
      'whatsapp',
      this.fetchImpl,
      `https://graph.facebook.com/${o.graphVersion}/${o.phoneNumberId}/messages`,
      { authorization: `Bearer ${o.accessToken}` },
      {
        messaging_product: 'whatsapp',
        to: message.destination.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: o.template,
          language: { code: o.templateLang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: message.code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: message.code }] },
          ],
        },
      },
      o.timeoutMs ?? OTP_HTTP_TIMEOUT_MS,
    );
  }
}
