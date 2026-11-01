import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1). */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Hash of a random string, verified on unknown identifiers so timing does not reveal account existence. */
  private dummyHash: Promise<string> = hash('caselind-timing-equalizer', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }
}
