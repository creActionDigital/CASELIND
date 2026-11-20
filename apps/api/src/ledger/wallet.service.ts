import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminLedgerAccount,
  ErrorCodes,
  type ExportedWallet,
  type LedgerReconciliation,
  type OrgWallet,
  type SandboxTopupRequest,
  type Wallet,
  type WalletTransactionList,
  type WalletTransactionsQuery,
  type WalletTransferRequest,
  type WalletTransferResponse,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AnomalyService } from '../wallet-finance/anomaly.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { KycPort } from '../wallet/kyc.port.js';
import type { LedgerOwner, TransferInput, TransferResult } from '../wallet/ledger.port.js';
import { PinVerifier, pinRefusal } from '../wallet/pin.port.js';
import { LedgerService } from './ledger.service.js';
import { balancesOf, reconcile, transactionsOf, type WalletScope } from './ledger.queries.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Rough CDF per USD, sandbox only (same as the KYC stub). */
const CDF_PER_USD = 2800;
/** Sandbox top-ups one user may make per hour. */
const TOPUP_PER_HOUR = 20;
const EXPORT_TRANSACTIONS_MAX = 10_000;

/** Whether the sandbox top-up may be used on this instance. */
export function sandboxTopupEnabled(env: Pick<Env, 'NODE_ENV' | 'WALLET_SANDBOX_TOPUP_ENABLED'>): boolean {
  return env.NODE_ENV !== 'production' || env.WALLET_SANDBOX_TOPUP_ENABLED === 'true';
}

const formatAmount = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`;

type ReplayRow = {
  kind: string;
  amount_minor: string;
  currency: string;
  created_at: Date;
  to_user: string | null;
}

/** Sandbox wallet: balances, history, P2P transfers, top-up and back-office. Never real money. */
@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly kyc: KycPort,
    private readonly pins: PinVerifier,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly anomaly: AnomalyService,
  ) {}

  async wallet(userId: string): Promise<Wallet> {
    const [balances, limits] = await Promise.all([
      balancesOf(this.db, { userId }, this.env.COMMERCE_CURRENCIES),
      this.kyc.limitsFor(userId, this.env.COMMERCE_CURRENCIES[0] ?? 'USD'),
    ]);
    return { mode: 'sandbox', kycTier: limits.tier, balances };
  }

  async orgWallet(orgId: string): Promise<OrgWallet> {
    return { mode: 'sandbox', balances: await balancesOf(this.db, { orgId }, this.env.COMMERCE_CURRENCIES) };
  }

  async transactions(scope: WalletScope, q: WalletTransactionsQuery): Promise<WalletTransactionList> {
    if (q.currency) this.assertCurrency(q.currency);
    const page = await transactionsOf(this.db, scope, q);
    return { mode: 'sandbox', ...page };
  }

  /** P2P transfer to a @handle. Unknown, inactive or blocked-either-way recipients are indistinguishable (404). */
  async transfer(auth: AuthUser, body: WalletTransferRequest, meta: RequestMeta): Promise<{ response: WalletTransferResponse; created: boolean }> {
    this.assertCurrency(body.currency);
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE handle = ${body.toHandle}::citext AND status = 'active'`);
    const recipientId = found.rows[0]?.id;
    if (recipientId === auth.userId) throw new AppError(400, ErrorCodes.validationFailed, 'You cannot send money to yourself');
    const blocked = recipientId
      ? await this.db.execute(sql`
          SELECT 1 FROM user_blocks
          WHERE (blocker_id = ${auth.userId}::uuid AND blocked_id = ${recipientId}::uuid)
             OR (blocker_id = ${recipientId}::uuid AND blocked_id = ${auth.userId}::uuid) LIMIT 1`)
      : null;
    if (!recipientId || (blocked && blocked.rows.length > 0)) throw AppError.notFound('Recipient not found');

    const pin = await this.pins.verify(auth.userId, body.pin);
    const refusal = pinRefusal(pin);
    if (refusal) throw refusal;

    const input: TransferInput = {
      from: { kind: 'user', userId: auth.userId },
      to: { kind: 'user', userId: recipientId },
      amountMinor: body.amountMinor,
      currency: body.currency,
      kind: 'p2p',
      idempotencyKey: body.clientId,
      initiatedBy: auth.userId,
      metadata: body.note ? { note: body.note } : {},
    };
    const result = await this.run(input, auth.userId, 'wallet.transfer', recipientId, meta, auth.sessionId);
    const response = await this.respond(result, input, auth.userId, recipientId);
    if (!response.replayed) await this.notifyReceived(recipientId, auth.userId, input.amountMinor, input.currency, response.transferId);
    return { response, created: !response.replayed };
  }

  /**
   * Transfer of the caller's sandbox funds to another user or to a system account, for features built on the wallet
   * (creator tips, boosted posts). Same PIN check, KYC limits, freeze check, idempotency (`clientId`) and audit as `transfer`;
   * `inTx` runs in the SAME transaction when the movement is new (never on a replay), so a side effect and its payment commit together.
   */
  async payInternal(
    auth: AuthUser,
    p: { to: LedgerOwner; amountMinor: number; currency: string; clientId: string; pin: string; metadata: Record<string, string> },
    meta: RequestMeta,
    inTx?: (tx: DbExecutor, transferId: string) => Promise<void>,
  ): Promise<WalletTransferResponse> {
    this.assertCurrency(p.currency);
    const pin = await this.pins.verify(auth.userId, p.pin);
    const refusal = pinRefusal(pin);
    if (refusal) throw refusal;
    const input: TransferInput = {
      from: { kind: 'user', userId: auth.userId },
      to: p.to,
      amountMinor: p.amountMinor,
      currency: p.currency,
      kind: 'p2p',
      idempotencyKey: p.clientId,
      initiatedBy: auth.userId,
      metadata: p.metadata,
    };
    const counterparty = p.to.kind === 'user' ? p.to.userId : null;
    const result = await this.run(input, auth.userId, 'wallet.transfer', counterparty, meta, auth.sessionId, inTx);
    return this.respond(result, input, auth.userId, counterparty);
  }

  /** Credits the caller from the sandbox funding account (fictitious funds). */
  async topup(auth: AuthUser, body: SandboxTopupRequest, meta: RequestMeta): Promise<{ response: WalletTransferResponse; created: boolean }> {
    if (!sandboxTopupEnabled(this.env)) throw AppError.featureDisabled('Sandbox top-up is disabled on this instance');
    this.assertCurrency(body.currency);
    const cap = this.env.WALLET_SANDBOX_TOPUP_MAX_MINOR * (body.currency === 'CDF' ? CDF_PER_USD : 1);
    if (body.amountMinor > cap) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
        { path: 'amountMinor', message: `at most ${cap} per top-up` },
      ]);
    }
    const recent = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM journal_entries
      WHERE initiated_by = ${auth.userId}::uuid AND kind = 'sandbox_topup' AND created_at > now() - interval '1 hour'`);
    if (Number(recent.rows[0]?.n ?? 0) >= TOPUP_PER_HOUR) {
      throw new AppError(429, ErrorCodes.rateLimited, 'Too many sandbox top-ups, try again later');
    }
    const input: TransferInput = {
      from: { kind: 'system', code: 'sandbox_funding' },
      to: { kind: 'user', userId: auth.userId },
      amountMinor: body.amountMinor,
      currency: body.currency,
      kind: 'sandbox_topup',
      idempotencyKey: body.clientId,
      initiatedBy: auth.userId,
      metadata: {},
    };
    const result = await this.run(input, auth.userId, 'wallet.sandbox_topup', null, meta, auth.sessionId);
    const response = await this.respond(result, input, auth.userId, auth.userId);
    return { response, created: !response.replayed };
  }

  /** Transfer + audit in one transaction (limits are read before it opens, see LedgerService.prefetchLimits). */
  private async run(
    input: TransferInput,
    actorId: string,
    action: 'wallet.transfer' | 'wallet.sandbox_topup',
    counterpartyId: string | null,
    meta: RequestMeta,
    sessionId: string,
    inTx?: (tx: DbExecutor, transferId: string) => Promise<void>,
  ): Promise<TransferResult> {
    const limits = await this.ledger.prefetchLimits(input);
    const outcome = await this.db.transaction(async (tx) => {
      const r = await this.ledger.transferWith(input, limits, tx);
      if (r.ok && !r.replayed) {
        if (inTx) await inTx(tx, r.transferId);
        // Amount, currency and counterparty id only: never the note.
        await this.audit.record(
          {
            action,
            actorUserId: actorId,
            sessionId,
            meta,
            metadata: { transferId: r.transferId, amountMinor: input.amountMinor, currency: input.currency, counterpartyId },
          },
          tx,
        );
      }
      return r;
    });
    // Anomaly alerts (information only, never blocks nor throws): after a new user-initiated send.
    if (outcome.ok && !outcome.replayed && action === 'wallet.transfer') await this.anomaly.afterTransfer(actorId, outcome.transferId, input.currency);
    return outcome;
  }

  private async respond(result: TransferResult, input: TransferInput, userId: string, toUserId: string | null): Promise<WalletTransferResponse> {
    if (!result.ok) {
      if (result.reason === 'insufficient_funds') throw AppError.conflict('Insufficient funds', { reason: 'insufficient_funds' });
      if (result.reason === 'limit_exceeded') throw AppError.conflict('Transfer limit exceeded', { reason: 'limit_exceeded' });
      if (result.reason === 'account_frozen') throw AppError.forbidden('An account involved is frozen');
      throw AppError.notFound('Recipient not found');
    }
    const row = await this.db.execute<ReplayRow>(sql`
      SELECT e.kind, e.amount_minor::text, e.currency::text AS currency, e.created_at,
        (SELECT a.user_id FROM postings p JOIN ledger_accounts a ON a.id = p.account_id
         WHERE p.entry_id = e.id AND p.amount_minor > 0 LIMIT 1) AS to_user
      FROM journal_entries e WHERE e.id = ${result.transferId}::uuid`);
    const e = row.rows[0]!;
    if (
      result.replayed &&
      (e.kind !== input.kind || Number(e.amount_minor) !== input.amountMinor || e.currency.trim() !== input.currency || e.to_user !== toUserId)
    ) {
      throw AppError.conflict('This clientId was already used for a different transfer', { reason: 'idempotency_mismatch' });
    }
    return {
      mode: 'sandbox',
      transferId: result.transferId,
      replayed: result.replayed,
      amountMinor: input.amountMinor,
      currency: input.currency,
      balanceMinor: await this.ledger.balance({ kind: 'user', userId }, input.currency),
      createdAt: new Date(e.created_at).toISOString(),
    };
  }

  private async notifyReceived(recipientId: string, senderId: string, amountMinor: number, currency: string, transferId: string): Promise<void> {
    const s = await this.db.execute<{ display_name: string }>(sql`SELECT display_name FROM users WHERE id = ${senderId}::uuid`);
    await this.notifications.notify({
      userId: recipientId,
      category: 'payment',
      title: 'Paiement reçu',
      body: `Vous avez reçu ${formatAmount(amountMinor, currency)} de ${s.rows[0]?.display_name ?? 'un utilisateur'}`,
      data: { transferId },
    });
  }

  private assertCurrency(currency: string): void {
    if (!this.env.COMMERCE_CURRENCIES.includes(currency)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
        { path: 'currency', message: `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}` },
      ]);
    }
  }

  /* ---------------------------------------------------------------- back-office */

  async adminAccount(id: string): Promise<AdminLedgerAccount> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Account not found');
    const res = await this.db.execute<AccountRow>(sql`
      SELECT a.id, a.owner_kind, a.user_id, a.org_id, a.system_code, a.currency::text AS currency, a.status,
             a.balance_minor::text, a.allow_negative, a.created_at,
             (SELECT COALESCE(SUM(amount_minor), 0)::text FROM postings WHERE account_id = a.id) AS ledger_minor
      FROM ledger_accounts a WHERE a.id = ${id}::uuid`);
    const r = res.rows[0];
    if (!r) throw AppError.notFound('Account not found');
    return toAdminAccount(r);
  }

  async setFrozen(id: string, frozen: boolean, actorId: string, sessionId: string, meta: RequestMeta): Promise<AdminLedgerAccount> {
    await this.applyFrozen(id, frozen, actorId, sessionId, meta);
    return this.adminAccount(id);
  }

  /** `exec`: an outer transaction (double validation), so the change commits with the decision. */
  async applyFrozen(id: string, frozen: boolean, actorId: string, sessionId: string | null, meta: RequestMeta, exec: Pick<Db, 'transaction'> = this.db): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Account not found');
    await exec.transaction(async (tx) => {
      const res = await tx.execute<{ user_id: string | null; org_id: string | null; owner_kind: string; currency: string; status: string }>(sql`
        UPDATE ledger_accounts SET status = ${frozen ? 'frozen' : 'active'} WHERE id = ${id}::uuid
        RETURNING user_id, org_id, owner_kind, currency::text AS currency, status`);
      const a = res.rows[0];
      if (!a) throw AppError.notFound('Account not found');
      await this.audit.record(
        {
          action: frozen ? 'ledger.account_frozen' : 'ledger.account_unfrozen',
          actorUserId: actorId,
          subjectUserId: a.user_id ?? actorId,
          sessionId,
          meta,
          metadata: { accountId: id, ownerKind: a.owner_kind, orgId: a.org_id, currency: a.currency.trim() },
        },
        tx,
      );
    });
  }

  reconcile(): Promise<LedgerReconciliation> {
    return reconcile(this.db);
  }

  /** Right of access: the user's balances and transactions (no data about the counterparties beyond name and handle). */
  async exportFor(userId: string): Promise<ExportedWallet> {
    const [balances, tx] = await Promise.all([
      balancesOf(this.db, { userId }, this.env.COMMERCE_CURRENCIES),
      transactionsOf(this.db, { userId }, { limit: EXPORT_TRANSACTIONS_MAX }),
    ]);
    return { mode: 'sandbox', balances, transactions: tx.items };
  }
}

type AccountRow = {
  id: string;
  owner_kind: 'user' | 'org' | 'system';
  user_id: string | null;
  org_id: string | null;
  system_code: 'sandbox_funding' | 'fees' | null;
  currency: string;
  status: 'active' | 'frozen';
  balance_minor: string;
  allow_negative: boolean;
  created_at: Date;
  ledger_minor: string;
}

function toAdminAccount(r: AccountRow): AdminLedgerAccount {
  return {
    id: r.id,
    ownerKind: r.owner_kind,
    userId: r.user_id,
    orgId: r.org_id,
    systemCode: r.system_code,
    currency: r.currency.trim(),
    status: r.status,
    balanceMinor: Number(r.balance_minor),
    ledgerBalanceMinor: Number(r.ledger_minor),
    allowNegative: r.allow_negative,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
