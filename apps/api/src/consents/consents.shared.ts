import { sql } from 'drizzle-orm';
import type { ConsentKind } from '@caselind/contracts';

/** Anything with `execute`: the pool or a transaction. */
type Executor = { execute: (q: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Appends one line to the consent journal, only when the answer really changes (a kind never answered
 * counts as withdrawn). Shared by the legacy health/marketing services so the journal stays complete.
 */
export async function appendConsent(db: Executor, userId: string, kind: ConsentKind, granted: boolean, version: string): Promise<void> {
  // Transaction-scoped lock (every caller passes its transaction): two parallel answers queue up, so the "only when it changes" test never reads a stale line.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`consent:${userId}:${kind}`}, 0))`);
  await db.execute(sql`
    INSERT INTO user_consents (user_id, kind, granted, version)
    SELECT ${userId}::uuid, ${kind}, ${granted}::boolean, ${version}
    WHERE COALESCE((SELECT granted FROM user_consents WHERE user_id = ${userId}::uuid AND kind = ${kind} ORDER BY seq DESC LIMIT 1), false) <> ${granted}::boolean`);
}

/** Anything with `execute` returning rows (the pool or a transaction). */
type Reader = { execute: (q: ReturnType<typeof sql>) => PromiseLike<{ rows: unknown[] }> };

/** Current answer for one kind: the latest journal line; never answered counts as withdrawn. */
export async function hasConsent(db: Reader, userId: string, kind: ConsentKind): Promise<boolean> {
  const res = await db.execute(sql`SELECT granted FROM user_consents WHERE user_id = ${userId}::uuid AND kind = ${kind} ORDER BY seq DESC LIMIT 1`);
  return (res.rows[0] as { granted: boolean } | undefined)?.granted === true;
}
