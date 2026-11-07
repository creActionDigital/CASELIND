import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { decodeKeyMaterial, ENV, type Env } from '../../config/env.js';

/**
 * AES-256-GCM for TOTP secrets, bound to the user (AAD). Format `v1:<iv>:<tag>:<ciphertext>` (base64url).
 * Outside production without TOTP_ENCRYPTION_KEY, a key is derived from JWT_ACCESS_SECRET.
 * Nothing here is ever logged.
 */
@Injectable()
export class TotpCrypto {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    const material = env.TOTP_ENCRYPTION_KEY
      ? decodeKeyMaterial(env.TOTP_ENCRYPTION_KEY)
      : Buffer.from(`totp:${env.JWT_ACCESS_SECRET}`);
    this.key = createHash('sha256').update(material).digest();
  }

  encrypt(userId: string, plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`totp:${userId}`));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(userId: string, stored: string): string {
    const [version, iv, tag, ct] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`totp:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}
