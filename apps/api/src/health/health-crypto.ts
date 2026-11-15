import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { decodeKeyMaterial, ENV, type Env } from '../config/env.js';

/**
 * AES-256-GCM for personal health data, bound to the owner (AAD): a ciphertext copied to another user fails to decrypt.
 * Format `v1:<iv>:<tag>:<ciphertext>` (base64url). Outside production without HEALTH_ENCRYPTION_KEY, a key is derived
 * from JWT_ACCESS_SECRET. Plaintext never reaches logs or audit.
 */
@Injectable()
export class HealthCrypto {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    const material = env.HEALTH_ENCRYPTION_KEY ? decodeKeyMaterial(env.HEALTH_ENCRYPTION_KEY) : Buffer.from(`health:${env.JWT_ACCESS_SECRET}`);
    this.key = createHash('sha256').update(material).digest();
  }

  seal(userId: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`health:${userId}`));
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  open<T>(userId: string, stored: string): T {
    const [version, iv, tag, ct] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`health:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')) as T;
  }
}
