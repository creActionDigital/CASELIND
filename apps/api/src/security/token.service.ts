import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../config/env.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  roles: string[];
}

const ISSUER = 'caselind-api';
const AUDIENCE = 'caselind-app';

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ sid: claims.sid, roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  /** Returns null for any invalid, expired or tampered token. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || !Array.isArray(payload.roles)) {
        return null;
      }
      return { sub: payload.sub, sid: payload.sid, roles: payload.roles.map(String) };
    } catch {
      return null;
    }
  }

  /** Opaque refresh token; only its SHA-256 hash is stored. */
  newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    return { token, hash: TokenService.hashRefresh(token), expiresAt };
  }

  static hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
