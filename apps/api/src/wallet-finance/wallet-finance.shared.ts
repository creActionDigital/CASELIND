import { ErrorCodes, type FinanceParty } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import type { Db } from '../db/db.module.js';
import type { TransferResult } from '../wallet/ledger.port.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const formatAmount = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`;

export const iso = (d: Date | string): string => new Date(d).toISOString();

export const userNotFound = (): AppError => AppError.notFound('User not found');

/** Same refusals as a wallet transfer (409 funds/limit, 403 frozen, 404 counterparty). */
export function transferRefusal(result: Extract<TransferResult, { ok: false }>): AppError {
  if (result.reason === 'insufficient_funds') return AppError.conflict('Insufficient funds', { reason: 'insufficient_funds' });
  if (result.reason === 'limit_exceeded') return AppError.conflict('Transfer limit exceeded', { reason: 'limit_exceeded' });
  if (result.reason === 'account_frozen') return AppError.forbidden('An account involved is frozen');
  return AppError.notFound('Recipient not found');
}

export function validation(path: string, message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
}

/** Active user by id or @handle that has no block with `callerId` either way; null when unknown, inactive or blocked (indistinguishable). */
export async function findReachableUser(
  ex: Pick<Db, 'execute'>,
  callerId: string,
  target: { handle?: string; id?: string },
): Promise<{ id: string; contactRequestsFrom: string } | null> {
  if (target.id && !UUID_RE.test(target.id)) return null;
  const found = await ex.execute<{ id: string; contact_requests_from: string }>(
    target.id
      ? sql`SELECT id, contact_requests_from FROM users WHERE id = ${target.id}::uuid AND status = 'active'`
      : sql`SELECT id, contact_requests_from FROM users WHERE handle = ${target.handle ?? ''}::citext AND status = 'active'`,
  );
  const u = found.rows[0];
  if (!u) return null;
  if (u.id !== callerId) {
    const blocked = await ex.execute(sql`
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = ${callerId}::uuid AND blocked_id = ${u.id}::uuid) OR (blocker_id = ${u.id}::uuid AND blocked_id = ${callerId}::uuid) LIMIT 1`);
    if (blocked.rows.length > 0) return null;
  }
  return { id: u.id, contactRequestsFrom: u.contact_requests_from };
}

export interface PartyRow {
  id: string;
  display_name: string;
  handle: string;
}

export const partyOf = (r: PartyRow): FinanceParty => ({ userId: r.id, displayName: r.display_name, handle: r.handle });

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

/** `[createdAt (ISO, exact), id]` or a 400. */
export function decodeCursor(cursor: string): [string, string] {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !/^[0-9: .+TZ-]{10,40}$/.test(at) || !UUID_RE.test(id)) throw validation('cursor', 'invalid cursor');
  return [at, id];
}

export type Exec = DbExecutor;
