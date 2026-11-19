import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { decodeKeyMaterial, ENV, type Env } from '../config/env.js';

/**
 * AES-256-GCM for personal health data, bound to the owner (AAD): a ciphertext copied to another user fails to decrypt.
 * Format `v1:<iv>:<tag>:<ciphertext>` (base64url). Outside production without HEALTH_ENCRYPTION_KEY, a key is derived
 * from JWT_ACCESS_SECRET. Plaintext never reaches logs or audit.
 */
const SEALED_MAGIC = Buffer.from('CLSEAL1\0', 'latin1');

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

  /**
   * Seals a file (health results, identity documents) at rest: `CLSEAL1\0` + iv(12) + tag(16) + ciphertext, the
   * media id as AAD so a sealed file copied under another id fails to open. Small files only (sealed in memory).
   */
  sealBytes(aad: string, data: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`file:${aad}`));
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([SEALED_MAGIC, iv, cipher.getAuthTag(), ct]);
  }

  /** Opens a stored file: one without the magic prefix is a legacy clear file and is returned unchanged. */
  openBytes(aad: string, stored: Buffer): Buffer {
    if (!stored.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC)) return stored;
    const o = SEALED_MAGIC.length;
    const decipher = createDecipheriv('aes-256-gcm', this.key, stored.subarray(o, o + 12));
    decipher.setAAD(Buffer.from(`file:${aad}`));
    decipher.setAuthTag(stored.subarray(o + 12, o + 28));
    return Buffer.concat([decipher.update(stored.subarray(o + 28)), decipher.final()]);
  }
}
