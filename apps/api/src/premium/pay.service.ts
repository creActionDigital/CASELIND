import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import type { TransferInput, TransferResult } from '../wallet/ledger.port.js';
import { PinVerifier, pinRefusal } from '../wallet/pin.port.js';

const CDF_PER_USD = 2800;
export const scaleUsd = (usdMinor: number, currency: string): number => usdMinor * (currency === 'CDF' ? CDF_PER_USD : 1);

export interface Charged {
  transferId: string;
  replayed: boolean;
  payer: 'user' | 'org';
}

/** Refus d'un virement du grand livre, comme le portefeuille : 409 fonds insuffisants, limite, compte gelé. */
export function transferRefusal(reason: string): AppError {
  if (reason === 'insufficient_funds') return AppError.conflict('Insufficient funds', { reason: 'insufficient_funds' });
  if (reason === 'limit_exceeded') return AppError.conflict('Transfer limit exceeded', { reason: 'limit_exceeded' });
  if (reason === 'account_frozen') return AppError.forbidden('An account involved is frozen');
  return AppError.notFound('Account not found');
}

/**
 * Paiement en MODE TEST des abonnements et de la publicité : débit du portefeuille de test vers le compte système `fees`
 * (kind 'p2p', metadata.ref), avec code PIN, clé d'idempotence, limites KYC et audit. Aucun argent réel. Point unique à remplacer
 * par un prestataire de paiement : la signature `charge` reste la même.
 */
@Injectable()
export class MonetizationPayService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly pins: PinVerifier,
    private readonly audit: AuditService,
  ) {}

  assertCurrency(currency: string): void {
    if (!this.env.COMMERCE_CURRENCIES.includes(currency)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
        { path: 'currency', message: `supported currencies: ${this.env.COMMERCE_CURRENCIES.join(', ')}` },
      ]);
    }
  }

  /** Membre actif de l'organisation (404 sinon : son existence n'est pas révélée) ; `manage` exige propriétaire ou admin (403). */
  async assertOrg(userId: string, orgId: string, manage: boolean): Promise<void> {
    const r = await this.db.execute<{ role: string }>(sql`
      SELECT m.role FROM org_members m JOIN organizations o ON o.id = m.org_id
      WHERE m.org_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.status = 'active' AND o.status = 'active'`);
    const role = r.rows[0]?.role;
    if (!role) throw AppError.notFound('Organization not found');
    if (manage && role !== 'owner' && role !== 'admin') throw AppError.forbidden('Only an owner or an admin can manage this');
  }

  /**
   * Débite l'organisation si son portefeuille couvre le montant, sinon l'utilisateur. `inTx` s'exécute dans la MÊME transaction
   * quand le mouvement est nouveau (jamais sur un rejeu) : l'effet et le paiement sont validés ensemble ou pas du tout.
   */
  async charge(
    auth: AuthUser,
    p: { orgId?: string | null; amountMinor: number; currency: string; clientId: string; pin: string; metadata: Record<string, string> },
    meta: RequestMeta,
    inTx: (tx: DbExecutor, transferId: string, payer: 'user' | 'org') => Promise<void>,
  ): Promise<Charged> {
    this.assertCurrency(p.currency);
    const fromOrg = !!p.orgId && (await this.ledger.balance({ kind: 'org', orgId: p.orgId }, p.currency)) >= p.amountMinor;
    if (!fromOrg) {
      const r = await this.wallet.payInternal(
        auth,
        { to: { kind: 'system', code: 'fees' }, amountMinor: p.amountMinor, currency: p.currency, clientId: p.clientId, pin: p.pin, metadata: p.metadata },
        meta,
        (tx, id) => inTx(tx, id, 'user'),
      );
      return { transferId: r.transferId, replayed: r.replayed, payer: 'user' };
    }
    const refusal = pinRefusal(await this.pins.verify(auth.userId, p.pin));
    if (refusal) throw refusal;
    const input: TransferInput = {
      from: { kind: 'org', orgId: p.orgId! },
      to: { kind: 'system', code: 'fees' },
      amountMinor: p.amountMinor,
      currency: p.currency,
      kind: 'p2p',
      idempotencyKey: p.clientId,
      initiatedBy: auth.userId,
      metadata: p.metadata,
    };
    const limits = await this.ledger.prefetchLimits(input);
    const res: TransferResult = await this.db.transaction(async (tx) => {
      const r = await this.ledger.transferWith(input, limits, tx);
      if (r.ok && !r.replayed) {
        await inTx(tx, r.transferId, 'org');
        await this.audit.record(
          { action: 'wallet.transfer', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { transferId: r.transferId, amountMinor: p.amountMinor, currency: p.currency, counterpartyId: null } },
          tx,
        );
      }
      return r;
    });
    if (!res.ok) throw transferRefusal(res.reason);
    return { transferId: res.transferId, replayed: res.replayed, payer: 'org' };
  }

  /** Rembourse (compte `fees` vers le payeur) dans `tx` ; la clé d'idempotence rend l'opération sûre à rejouer. */
  async refund(tx: DbExecutor, to: { userId: string; orgId: string | null }, amountMinor: number, currency: string, key: string, metadata: Record<string, string>): Promise<void> {
    if (amountMinor <= 0) return;
    const r = await this.ledger.transfer(
      {
        from: { kind: 'system', code: 'fees' },
        to: to.orgId ? { kind: 'org', orgId: to.orgId } : { kind: 'user', userId: to.userId },
        amountMinor,
        currency,
        kind: 'refund',
        idempotencyKey: key,
        initiatedBy: null,
        metadata,
      },
      tx,
    );
    if (!r.ok) throw AppError.conflict('The refund cannot be made now', { reason: r.reason });
  }
}
