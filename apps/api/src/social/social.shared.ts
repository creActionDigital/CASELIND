import { ErrorCodes } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { UUID_RE } from '../messaging/messaging.shared.js';

export { UUID_RE };

export const userNotFound = () => AppError.notFound('User not found');
export const postNotFound = () => AppError.notFound('Post not found');
export const commentNotFound = () => AppError.notFound('Comment not found');

export function validationError(path: string, message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
}

/** Opaque keyset cursor `(timestamp text, uuid)`; the timestamp keeps full microsecond precision. */
export function encodeCursor(exactTs: string, id: string): string {
  return Buffer.from(JSON.stringify([exactTs, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { ts: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      !Number.isNaN(Date.parse(v[0])) &&
      typeof v[1] === 'string' &&
      UUID_RE.test(v[1])
    ) {
      return { ts: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}

export const SOCIAL_CATEGORY = 'social' as const;
