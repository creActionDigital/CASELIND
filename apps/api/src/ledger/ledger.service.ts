import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { type KycLimits, KycPort } from '../wallet/kyc.port.js';
import { LedgerPort, type LedgerOwner, type PrefetchedLimits, type TransferInput, type TransferResult } from '../wallet/ledger.port.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const DAY_MS = 86_400_000;

type AccountRow = {
  id: string;
  status: 'active' | 'frozen';
  balance_minor: string;
  allow_negative: boolean;
}

/** Stable text key of an owner, used to order account creation (no lock-order inversion between transfers). */
const ownerKey = (o: LedgerOwner): string =>
  o.kind === 'user' ? `u:${o.userId}` : o.kind === 'org' ? `o:${o.orgId}` : `s:${o.code}`;

/**
 * Double-entry ledger (lot 6A). One journal entry per movement; its postings sum to zero (checked by a deferred
 * constraint trigger); entries and postings are append-only (triggers). The accounts involved are locked
 * FOR UPDATE in id order, so concurrent transfers serialise without deadlocking and a balance never goes negative.
 * Sandbox only: no real money (CDC §17).
 */
@Injectable()
export class LedgerService extends LedgerPort {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kyc: KycPort,
  ) {
    super();
  }

  override async transfer(input: TransferInput, tx?: DbExecutor, prefetched?: PrefetchedLimits): Promise<TransferResult> {
    const limits = prefetched ?? (await this.prefetchLimits(input));
    if (tx) return this.transferWith(input, limits, tx);
    return this.db.transaction((t) => this.transferWith(input, limits, t));
  }

  override async balance(owner: LedgerOwner, currency: string): Promise<number> {
    const id = await this.findAccountId(this.db, owner, currency);
    if (!id) return 0;
    const res = await this.db.execute<{ balance_minor: string }>(
      sql`SELECT balance_minor::text FROM ledger_accounts WHERE id = ${id}::uuid`,
    );
    return Number(res.rows[0]?.balance_minor ?? 0);
  }

  /**
   * Limits are read before the transaction opens: the KYC module may query the database with another pooled
   * connection, which must not happen while this one is held.
   */
  override async prefetchLimits(input: TransferInput): Promise<PrefetchedLimits> {
    const limits: PrefetchedLimits = { sender: null, recipient: null };
    if (input.initiatedBy === null) return limits;
    if (input.from.kind === 'user') limits.sender = await this.kyc.limitsFor(input.from.userId, input.currency);
    if (input.to.kind === 'user') limits.recipient = await this.kyc.limitsFor(input.to.userId, input.currency);
    return limits;
  }

  /** The transfer itself, inside `tx`. */
  async transferWith(input: TransferInput, limits: PrefetchedLimits, tx: DbExecutor): Promise<TransferResult> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{3}$/.test(input.currency)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Invalid transfer amount or currency');
    }
    if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Invalid idempotency key');
    }
    if (ownerKey(input.from) === ownerKey(input.to)) return { ok: false, reason: 'invalid_counterparty' };

    // Serialise same-key requests (concurrent retries): the second one then sees the first one's entry.
    const initiator = input.initiatedBy ?? NIL_UUID;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${initiator}:${input.idempotencyKey}`}, 0))`);
    const existing = await tx.execute<{ id: string; kind: string; amount_minor: string; currency: string; from_id: string | null; to_id: string | null }>(sql`
      SELECT e.id, e.kind, e.amount_minor::text, e.currency::text AS currency,
        (SELECT account_id::text FROM postings WHERE entry_id = e.id AND amount_minor < 0 LIMIT 1) AS from_id,
        (SELECT account_id::text FROM postings WHERE entry_id = e.id AND amount_minor > 0 LIMIT 1) AS to_id
      FROM journal_entries e
      WHERE COALESCE(e.initiated_by, ${NIL_UUID}::uuid) = ${initiator}::uuid AND e.idempotency_key = ${input.idempotencyKey}`);
    const prior = existing.rows[0];
    if (prior) {
      // The same key must describe the same movement: another amount, currency, kind or counterparty is a client bug (or an attack).
      const fromId = await this.findAccountId(tx, input.from, input.currency);
      const toId = await this.findAccountId(tx, input.to, input.currency);
      if (
        prior.kind !== input.kind ||
        Number(prior.amount_minor) !== input.amountMinor ||
        prior.currency.trim() !== input.currency ||
        prior.from_id !== fromId ||
        prior.to_id !== toId
      ) {
        throw AppError.conflict('This idempotency key was already used for a different transfer', { reason: 'idempotency_mismatch' });
      }
      return { ok: true, transferId: prior.id, replayed: true };
    }

    // Accounts are created in a canonical order so two opposite transfers cannot wait for each other.
    const owners = [input.from, input.to].sort((a, b) => ownerKey(a).localeCompare(ownerKey(b)));
    const ids = new Map<string, string>();
    for (const o of owners) {
      const id = await this.ensureAccount(tx, o, input.currency);
      if (!id) return { ok: false, reason: 'invalid_counterparty' };
      ids.set(ownerKey(o), id);
    }
    const fromId = ids.get(ownerKey(input.from))!;
    const toId = ids.get(ownerKey(input.to))!;

    // Row locks in id order.
    const locked = await tx.execute<AccountRow>(sql`
      SELECT id, status, balance_minor::text, allow_negative FROM ledger_accounts
      WHERE id IN (${fromId}::uuid, ${toId}::uuid) ORDER BY id FOR UPDATE`);
    const from = locked.rows.find((r) => r.id === fromId)!;
    const to = locked.rows.find((r) => r.id === toId)!;

    if (from.status === 'frozen' || to.status === 'frozen') return { ok: false, reason: 'account_frozen' };

    if (limits.sender && input.from.kind === 'user') {
      if (input.amountMinor > limits.sender.maxSingleTransferMinor) return { ok: false, reason: 'limit_exceeded' };
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const out = await tx.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(-amount_minor), 0)::text AS total FROM postings
        WHERE account_id = ${fromId}::uuid AND amount_minor < 0 AND created_at > ${since}::timestamptz`);
      if (Number(out.rows[0]?.total ?? 0) + input.amountMinor > limits.sender.maxDailyOutgoingMinor) {
        return { ok: false, reason: 'limit_exceeded' };
      }
    }
    if (limits.recipient && input.to.kind === 'user') {
      if (Number(to.balance_minor) + input.amountMinor > limits.recipient.maxBalanceMinor) {
        return { ok: false, reason: 'limit_exceeded' };
      }
    }
    if (!from.allow_negative && Number(from.balance_minor) < input.amountMinor) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const entry = await tx.execute<{ id: string }>(sql`
      INSERT INTO journal_entries (kind, idempotency_key, initiated_by, currency, amount_minor, metadata)
      VALUES (${input.kind}, ${input.idempotencyKey}, ${input.initiatedBy}::uuid, ${input.currency}, ${input.amountMinor},
              ${JSON.stringify(input.metadata ?? {})}::jsonb)
      RETURNING id`);
    const entryId = entry.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO postings (entry_id, account_id, currency, amount_minor) VALUES
        (${entryId}::uuid, ${fromId}::uuid, ${input.currency}, ${-input.amountMinor}),
        (${entryId}::uuid, ${toId}::uuid, ${input.currency}, ${input.amountMinor})`);
    return { ok: true, transferId: entryId, replayed: false };
  }

  /** Account id of an owner in a currency, without creating it. */
  async findAccountId(ex: DbExecutor, owner: LedgerOwner, currency: string): Promise<string | null> {
    const where =
      owner.kind === 'user'
        ? sql`owner_kind = 'user' AND user_id = ${owner.userId}::uuid`
        : owner.kind === 'org'
          ? sql`owner_kind = 'org' AND org_id = ${owner.orgId}::uuid`
          : sql`owner_kind = 'system' AND system_code = ${owner.code}`;
    const res = await ex.execute<{ id: string }>(sql`SELECT id FROM ledger_accounts WHERE ${where} AND currency = ${currency}`);
    return res.rows[0]?.id ?? null;
  }

  /** Gets or creates the account; null when the owner cannot hold one (unknown, inactive user or organisation). */
  private async ensureAccount(tx: DbExecutor, owner: LedgerOwner, currency: string): Promise<string | null> {
    if (owner.kind === 'user') {
      const u = await tx.execute<{ status: string }>(sql`SELECT status FROM users WHERE id = ${owner.userId}::uuid`);
      if (u.rows[0]?.status !== 'active') return null;
      await tx.execute(sql`
        INSERT INTO ledger_accounts (owner_kind, user_id, currency) VALUES ('user', ${owner.userId}::uuid, ${currency})
        ON CONFLICT (user_id, currency) WHERE owner_kind = 'user' DO NOTHING`);
    } else if (owner.kind === 'org') {
      const o = await tx.execute<{ status: string }>(sql`SELECT status FROM organizations WHERE id = ${owner.orgId}::uuid`);
      if (o.rows[0]?.status !== 'active') return null;
      await tx.execute(sql`
        INSERT INTO ledger_accounts (owner_kind, org_id, currency) VALUES ('org', ${owner.orgId}::uuid, ${currency})
        ON CONFLICT (org_id, currency) WHERE owner_kind = 'org' DO NOTHING`);
    } else {
      await tx.execute(sql`
        INSERT INTO ledger_accounts (owner_kind, system_code, currency, allow_negative)
        VALUES ('system', ${owner.code}, ${currency}, ${owner.code === 'sandbox_funding'})
        ON CONFLICT (system_code, currency) WHERE owner_kind = 'system' DO NOTHING`);
    }
    return this.findAccountId(tx, owner, currency);
  }
}
