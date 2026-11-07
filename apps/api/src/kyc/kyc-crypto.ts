import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { decodeKeyMaterial, ENV, type Env } from '../config/env.js';

/**
 * AES-256-GCM for identity document numbers. The ciphertext is bound to the user (AAD), so a value
 * copied to another row does not decrypt. Format: `v1:<iv>:<tag>:<ciphertext>` (base64url).
 * Nothing here is ever logged.
 */
@Injectable()
export class KycCrypto {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // 32 bytes whatever the length of the configured material. Outside production without a configured key,
    // one is derived from the access-token secret so a dev machine starts without extra setup.
    const material = env.KYC_ENCRYPTION_KEY ? decodeKeyMaterial(env.KYC_ENCRYPTION_KEY) : Buffer.from(`kyc:${env.JWT_ACCESS_SECRET}`);
    this.key = createHash('sha256').update(material).digest();
  }

  encrypt(userId: string, plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`kyc:${userId}`));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(userId: string, stored: string): string {
    const [version, iv, tag, ct] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`kyc:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}
