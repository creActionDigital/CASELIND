import { ErrorCodes } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque keyset cursor on (timestamp text with full microsecond precision, uuid). */
export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify([ts, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { ts: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) {
      return { ts: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}

export function validationError(path: string, message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
}
