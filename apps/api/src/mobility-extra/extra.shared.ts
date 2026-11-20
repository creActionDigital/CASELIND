import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { forbiddenBecause } from '../mobility/mobility.shared.js';
import type { KycPort } from '../wallet/kyc.port.js';

export type Exec = Pick<Db, 'execute'>;

/** Raw rows: timestamps (columns named *_at) come back as text from this driver, normalise them to Date. */
export const rowsOf = async <T>(e: Exec, q: SQL): Promise<T[]> =>
  (await e.execute(q)).rows.map((r) => {
    const row = r as Record<string, unknown>;
    for (const k of Object.keys(row)) if (k.endsWith('_at') && typeof row[k] === 'string') row[k] = new Date(row[k] as string);
    return row;
  }) as T[];

export const num = (v: string | number | null): number => (v === null ? 0 : Number(v));
export const isoOf = (v: Date | string): string => new Date(v).toISOString();
export const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : isoOf(v));
export const uuidList = (list: string[]): SQL => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `);

export const PAY_CASH_NOTE = 'Aucun paiement en ligne : à régler sur place, en espèces.';

/** Whether a block exists between the two users, in either direction. */
export async function blockedBetween(exec: Exec, a: string, b: string): Promise<boolean> {
  const r = await exec.execute(sql`
    SELECT 1 FROM user_blocks WHERE (blocker_id = ${a}::uuid AND blocked_id = ${b}::uuid) OR (blocker_id = ${b}::uuid AND blocked_id = ${a}::uuid) LIMIT 1`);
  return r.rows.length > 0;
}

/** An approved mobility driver with identity verification level 1: the profile that may drive a carpool or help on the road. */
export async function requireApprovedDriver(exec: Exec, kyc: Pick<KycPort, 'limitsFor'>, userId: string): Promise<void> {
  const found = await exec.execute(sql`SELECT 1 FROM mobility_drivers WHERE user_id = ${userId}::uuid AND status = 'approved'`);
  if (found.rows.length === 0) throw forbiddenBecause('Register as a driver and get approved first', 'driver_not_approved');
  if ((await kyc.limitsFor(userId, 'USD')).tier < 1) throw forbiddenBecause('Identity verification (level 1) is required', 'kyc_required');
}

/** Keyset cursor over (timestamp text, id). */
export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: ts, i: id }), 'utf8').toString('base64url');
}
export function decodeCursor(raw: string): { ts: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    if (typeof v.t !== 'string' || typeof v.i !== 'string') return null;
    const d = new Date(v.t);
    // Canonical ISO text for Postgres; out-of-range years (5-digit, signed) are refused.
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 9999) return null;
    return { ts: d.toISOString(), id: v.i };
  } catch {
    return null;
  }
}

export const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};
