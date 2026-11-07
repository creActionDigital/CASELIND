import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '../commerce/catalog.port.js';
import type { KycLimits } from './kyc.port.js';

/** KYC limits fetched before any transaction is opened (the KYC module may use another pooled connection). */
export interface PrefetchedLimits {
  sender: KycLimits | null;
  recipient: KycLimits | null;
}

/** Who owns a ledger account. System accounts back sandbox funding and fees. */
export type LedgerOwner =
  | { kind: 'user'; userId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'system'; code: 'sandbox_funding' | 'fees' };

export type TransferKind = 'p2p' | 'merchant_payment' | 'sandbox_topup' | 'refund' | 'adjustment';

export interface TransferInput {
  from: LedgerOwner;
  to: LedgerOwner;
  /** Minor units, > 0. */
  amountMinor: number;
  currency: string;
  kind: TransferKind;
  /** Unique per initiator: replaying the same key returns the first result, never moves money twice. */
  idempotencyKey: string;
  /** User who initiated it (audit, limits); null for system operations. */
  initiatedBy: string | null;
  /** Short, non-sensitive context shown in histories (e.g. `{ note, orgId, qrId }`). */
  metadata?: Record<string, string>;
}

export type TransferResult =
  | { ok: true; transferId: string; replayed: boolean }
  | { ok: false; reason: 'insufficient_funds' | 'limit_exceeded' | 'account_frozen' | 'invalid_counterparty' };

/**
 * Double-entry ledger (lot 6A). Every movement is one journal entry whose postings sum to zero per
 * currency; entries are append-only. Implemented by the ledger module; the stub moves nothing.
 */
@Injectable()
export class LedgerPort {
  /** Moves funds atomically (in `tx` when given, else in its own transaction), honouring KYC limits. */
  async transfer(_input: TransferInput, _tx?: DbExecutor, _limits?: PrefetchedLimits): Promise<TransferResult> {
    return { ok: false, reason: 'invalid_counterparty' };
  }
  /** Limits to read BEFORE opening the transaction that will be passed to `transfer` (avoids holding two pooled connections). */
  async prefetchLimits(_input: TransferInput): Promise<PrefetchedLimits> {
    return { sender: null, recipient: null };
  }
  /** Available balance in minor units (0 for an account that does not exist yet). */
  async balance(_owner: LedgerOwner, _currency: string): Promise<number> {
    return 0;
  }
}
