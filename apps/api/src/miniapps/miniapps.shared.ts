import { type SQL, sql } from 'drizzle-orm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErrorCodes, type MiniApp, type MiniAppPublic, type MiniAppScope } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { contentUrlOf } from '../media/media.service.js';

/** Access tokens live 15 minutes, refresh tokens 30 days, authorization codes 60 seconds, payment requests 10 minutes. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 86_400_000;
export const AUTH_CODE_TTL_SECONDS = 60;
export const PAYMENT_REQUEST_TTL_MS = 10 * 60_000;

/** Prefixes make a leaked value recognisable (secret scanning) and let the guards reject foreign tokens early. */
export const ACCESS_PREFIX = 'cla_';
export const REFRESH_PREFIX = 'clr_';
export const SECRET_PREFIX = 'cls_';

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const randomToken = (prefix: string, bytes = 32): string => prefix + randomBytes(bytes).toString('base64url');
export const newClientId = (): string => `cl_${randomBytes(12).toString('base64url')}`;

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const iso = (v: string | Date): string => new Date(v).toISOString();

/** OAuth-style rejection: HTTP status, stable code, and the RFC 6749 error in `details.error`. */
export function oauthError(error: 'invalid_grant' | 'invalid_request' | 'invalid_scope' | 'invalid_redirect_uri' | 'unauthorized_client', message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, message, { error });
}
export const invalidClient = (): AppError => new AppError(401, ErrorCodes.unauthenticated, 'Client authentication failed', { error: 'invalid_client' });
export const appNotFound = (): AppError => AppError.notFound('Application not found');

export type AppRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  icon_media_id: string | null;
  launch_url: string;
  redirect_uris: string[];
  scopes: string[];
  confidential: boolean;
  client_id: string;
  client_secret_hash: string | null;
  status: MiniApp['status'];
  review_note: string | null;
  reviewed_at: string | Date | null;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export const APP_COLUMNS =
  'id, org_id, name, description, icon_media_id, launch_url, redirect_uris, scopes, confidential, client_id, client_secret_hash, status, review_note, reviewed_at, published_at, created_at, updated_at';

export const iconUrlOf = (mediaId: string | null): string | null => (mediaId ? contentUrlOf(mediaId) : null);

export function toApp(r: AppRow): MiniApp {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description,
    iconUrl: iconUrlOf(r.icon_media_id),
    launchUrl: r.launch_url,
    redirectUris: r.redirect_uris,
    scopes: r.scopes as MiniAppScope[],
    confidential: r.confidential,
    clientId: r.client_id,
    status: r.status,
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
    publishedAt: r.published_at ? iso(r.published_at) : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export type PublicAppRow = AppRow & { org_name: string; org_verification: string };

export function toPublicApp(r: PublicAppRow): MiniAppPublic {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    iconUrl: iconUrlOf(r.icon_media_id),
    launchUrl: r.launch_url,
    clientId: r.client_id,
    scopes: r.scopes as MiniAppScope[],
    organization: { id: r.org_id, name: r.org_name, verified: r.org_verification === 'verified' },
  };
}

/** A text[] parameter: drizzle expands a JS array into a record, so build the ARRAY[...] by hand. */
export const textArray = (values: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
