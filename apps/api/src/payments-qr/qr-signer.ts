import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

const VERSION = 'CLQ1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface QrFields {
  orgId: string;
  qrId: string;
  /** null = the payer chooses the amount. */
  amountMinor: number | null;
  currency: string;
  /** Unix seconds; null = static QR without expiry. */
  expiresAtSec: number | null;
}

/**
 * Compact signed payload `CLQ1.<orgId>.<qrId>.<amount>.<currency>.<expiry>.<signature>` (empty amount / expiry when absent).
 * The signature is HMAC-SHA256 over everything before it, base64url. A forged or altered payload fails
 * with no hint about which part was wrong.
 */
@Injectable()
export class QrSigner {
  private readonly secret: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // Without a configured secret (non-production only), derive one from the access-token secret.
    this.secret = env.PAYMENT_QR_SECRET
      ? Buffer.from(env.PAYMENT_QR_SECRET)
      : createHmac('sha256', env.JWT_ACCESS_SECRET).update('caselind:payment-qr').digest();
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.secret).update(body).digest();
  }

  sign(f: QrFields): string {
    const body = [VERSION, f.orgId, f.qrId, f.amountMinor ?? '', f.currency, f.expiresAtSec ?? ''].join('.');
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  /** The fields when the signature and the shape are valid, else null. */
  verify(payload: string): QrFields | null {
    const parts = payload.split('.');
    if (parts.length !== 7 || parts[0] !== VERSION) return null;
    const [, orgId, qrId, amount, currency, expiry, sig] = parts as [string, string, string, string, string, string, string];
    const given = Buffer.from(sig, 'base64url');
    const expected = this.mac(parts.slice(0, 6).join('.'));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (!UUID.test(orgId) || !UUID.test(qrId) || !/^[A-Z]{3}$/.test(currency)) return null;
    if (!/^(?:[1-9]\d{0,15})?$/.test(amount) || !/^(?:[1-9]\d{0,11})?$/.test(expiry)) return null;
    return {
      orgId,
      qrId,
      amountMinor: amount === '' ? null : Number(amount),
      currency,
      expiresAtSec: expiry === '' ? null : Number(expiry),
    };
  }
}
