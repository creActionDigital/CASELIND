import { ErrorCodes } from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const productNotFound = () => AppError.notFound('Product not found');

export function validationError(path: string, message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
}

/** Opaque keyset cursor `(sort key as text, uuid)`. */
export function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, kind: 'time' | 'int'): { key: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && UUID_RE.test(v[1])) {
      const ok = kind === 'time' ? !Number.isNaN(Date.parse(v[0])) : /^\d{1,15}$/.test(v[0]);
      if (ok) return { key: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Search clause over title/description (`p` = products). */
export function searchSql(q: string | undefined): SQL {
  if (!q) return sql``;
  const pattern = `%${escapeLike(q)}%`;
  return sql`AND (p.title ILIKE ${pattern} OR p.description ILIKE ${pattern})`;
}

/** Human label of a variant's options, e.g. "taille: M, couleur: rouge"; null when it has none. */
export function variantLabelOf(options: Record<string, string> | null | undefined): string | null {
  const entries = Object.entries(options ?? {});
  return entries.length === 0 ? null : entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

/** Whether the product (alias `p`) with its org (alias `o`) is shown to buyers; `viewerId` null = anonymous. */
export function buyerVisibleSql(viewerId: string | null): SQL {
  const blocks = viewerId
    ? sql`AND NOT EXISTS (
        SELECT 1 FROM org_members om
        JOIN user_blocks b ON (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = om.user_id)
                           OR (b.blocker_id = om.user_id AND b.blocked_id = ${viewerId}::uuid)
        WHERE om.org_id = p.org_id AND om.role = 'owner' AND om.status = 'active')`
    : sql``;
  return sql`(p.status = 'published' AND NOT p.hidden AND o.status = 'active' AND o.visibility = 'public' ${blocks})`;
}
