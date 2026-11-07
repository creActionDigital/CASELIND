import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatedPaymentQr,
  type CreatePaymentQrRequest,
  ErrorCodes,
  type PageQuery,
  type PayQrRequest,
  type PayQrResponse,
  type PaymentQr,
  type PaymentQrList,
  type QrRejectionReason,
  type ResolvedPaymentQr,
} from '@caselind/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { organizations, orgMembers, paymentQrCodes, type PaymentQrRow } from '../db/schema.js';
import { PinService } from '../kyc/pin.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import type { OrgMembership } from '../orgs/org.guard.js';
import { decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';
import { pinRefusal } from '../wallet/pin.port.js';
import { LedgerPort, type TransferInput } from '../wallet/ledger.port.js';
import { QrSigner } from './qr-signer.js';

/** Fixed-amount QR codes live this long when the caller gives no duration. */
const DEFAULT_FIXED_TTL_SECONDS = 900;

function rejection(reason: QrRejectionReason, status = 400): AppError {
  // Same message whatever the reason: only `details.reason` tells the client what to show.
  return new AppError(status, ErrorCodes.validationFailed, 'This QR code cannot be used', { reason });
}

function statusOf(r: PaymentQrRow, now: Date): PaymentQr['status'] {
  if (r.revokedAt) return 'revoked';
  if (r.consumedAt) return 'consumed';
  if (r.expiresAt && r.expiresAt <= now) return 'expired';
  return 'active';
}

const toQr = (r: PaymentQrRow, now = new Date()): PaymentQr => ({
  qrId: r.id,
  orgId: r.orgId,
  amountMinor: r.amountMinor,
  currency: r.currency,
  label: r.label,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  singleUse: r.singleUse,
  status: statusOf(r, now),
  createdAt: r.createdAt.toISOString(),
});

interface CheckedQr {
  row: PaymentQrRow;
  org: { id: string; name: string; verified: boolean };
}

/** Merchant payment QR codes (D-03): signed payload, revocable and optionally single-use. Sandbox only. */
@Injectable()
export class PaymentQrService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly signer: QrSigner,
    private readonly audit: AuditService,
    private readonly pins: PinService,
    private readonly ledger: LedgerPort,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Merchant side ---

  /** `finance.view` or `orders.manage`; OrgGuard already proved an active membership. */
  private assertMerchantRole(m: OrgMembership): void {
    if (!roleHasPermission(m.role, 'finance.view') && !roleHasPermission(m.role, 'orders.manage')) throw AppError.forbidden();
  }

  async create(m: OrgMembership, userId: string, body: CreatePaymentQrRequest, meta: RequestMeta): Promise<CreatedPaymentQr> {
    this.assertMerchantRole(m);
    if (!this.env.COMMERCE_CURRENCIES.includes(body.currency)) throw validationError('currency', 'currency not supported');
    const fixed = body.amountMinor !== undefined;
    const ttl = body.expiresInSeconds ?? (fixed ? DEFAULT_FIXED_TTL_SECONDS : null);
    const expiresAtSec = ttl === null ? null : Math.floor(Date.now() / 1000) + ttl;
    const id = randomUUID();
    const [row] = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(paymentQrCodes)
        .values({
          id,
          orgId: m.orgId,
          createdBy: userId,
          amountMinor: body.amountMinor ?? null,
          currency: body.currency,
          label: body.label ?? null,
          expiresAt: expiresAtSec === null ? null : new Date(expiresAtSec * 1000),
          singleUse: body.singleUse ?? fixed,
        })
        .returning();
      await this.audit.record(
        {
          action: 'wallet.qr_created',
          actorUserId: userId,
          meta,
          metadata: { orgId: m.orgId, qrId: id, currency: body.currency, ...(fixed ? { amountMinor: body.amountMinor } : {}) },
        },
        tx,
      );
      return inserted;
    });
    const payload = this.signer.sign({
      orgId: m.orgId,
      qrId: id,
      amountMinor: body.amountMinor ?? null,
      currency: body.currency,
      expiresAtSec,
    });
    return { ...toQr(row!), payload };
  }

  async list(m: OrgMembership, q: PageQuery): Promise<PaymentQrList> {
    this.assertMerchantRole(m);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ id: string; ts: string }>(sql`
      SELECT id, created_at::text AS ts FROM payment_qr_codes
      WHERE org_id = ${m.orgId}
        ${cursor ? sql`AND (created_at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const rows = page.length
      ? await this.db
          .select()
          .from(paymentQrCodes)
          .where(inArray(paymentQrCodes.id, page.map((p) => p.id)))
          .orderBy(desc(paymentQrCodes.createdAt), desc(paymentQrCodes.id))
      : [];
    const now = new Date();
    const last = page.at(-1);
    return { items: rows.map((r) => toQr(r, now)), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  /** Idempotent. A QR of another org is a 404. */
  async revoke(m: OrgMembership, userId: string, qrId: string, meta: RequestMeta): Promise<void> {
    this.assertMerchantRole(m);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(paymentQrCodes)
        .where(and(eq(paymentQrCodes.id, qrId), eq(paymentQrCodes.orgId, m.orgId)))
        .for('update')
        .limit(1);
      if (!row) throw AppError.notFound('QR code not found');
      if (row.revokedAt) return;
      await tx.update(paymentQrCodes).set({ revokedAt: new Date() }).where(eq(paymentQrCodes.id, qrId));
      await this.audit.record({ action: 'wallet.qr_revoked', actorUserId: userId, meta, metadata: { orgId: m.orgId, qrId } }, tx);
    });
  }

  // --- Payer side ---

  /**
   * Signature, then state. Every failure is a 400 `details.reason`; before the signature checks out
   * nothing about the QR or the org is revealed.
   */
  private async check(payload: string, now = new Date()): Promise<{ checked: CheckedQr; amountMinor: number | null }> {
    const f = this.signer.verify(payload);
    if (!f) throw rejection('invalid_qr');
    const [found] = await this.db
      .select({
        row: paymentQrCodes,
        orgName: organizations.name,
        orgStatus: organizations.status,
        verification: organizations.verificationStatus,
      })
      .from(paymentQrCodes)
      .innerJoin(organizations, eq(organizations.id, paymentQrCodes.orgId))
      .where(eq(paymentQrCodes.id, f.qrId))
      .limit(1);
    if (
      !found ||
      found.row.orgId !== f.orgId ||
      found.row.currency !== f.currency ||
      found.row.amountMinor !== f.amountMinor ||
      found.orgStatus !== 'active'
    ) {
      throw rejection('invalid_qr');
    }
    if (f.expiresAtSec !== null && f.expiresAtSec * 1000 <= now.getTime()) throw rejection('expired');
    if (found.row.revokedAt) throw rejection('revoked');
    return {
      checked: { row: found.row, org: { id: f.orgId, name: found.orgName, verified: found.verification === 'verified' } },
      amountMinor: f.amountMinor,
    };
  }

  async resolve(payload: string): Promise<ResolvedPaymentQr> {
    const { checked } = await this.check(payload);
    if (checked.row.consumedAt) throw rejection('already_used');
    return {
      org: checked.org,
      amountMinor: checked.row.amountMinor,
      currency: checked.row.currency,
      label: checked.row.label,
      qrId: checked.row.id,
    };
  }

  async pay(userId: string, body: PayQrRequest, meta: RequestMeta): Promise<PayQrResponse> {
    const { checked, amountMinor: fixed } = await this.check(body.payload);
    const { row, org } = checked;
    const replay = row.consumedAt !== null && row.consumedBy === userId && row.consumedClientId === body.clientId;
    if (row.consumedAt && !replay) throw rejection('already_used');
    const amountMinor = fixed ?? body.amountMinor;
    if (amountMinor === undefined) throw rejection('amount_required');

    const pin = await this.pins.verify(userId, body.pin);
    // Same statuses and details as the wallet transfer route.
    const refusal = pinRefusal(pin);
    if (refusal) throw refusal;

    // Limits are read before the transaction opens: holding a pooled connection while waiting for another one
    // would starve the pool under concurrent payments.
    const transferInput: TransferInput = {
      from: { kind: 'user', userId },
      to: { kind: 'org', orgId: org.id },
      amountMinor,
      currency: row.currency,
      kind: 'merchant_payment',
      idempotencyKey: `qr:${body.clientId}`,
      initiatedBy: userId,
      metadata: { qrId: row.id, orgId: org.id },
    };
    const limits = await this.ledger.prefetchLimits(transferInput);
    const result = await this.db.transaction(async (tx) => {
      // Re-read under lock: a revocation or a concurrent payment of a single-use QR wins over the check above.
      const [locked] = await tx.select().from(paymentQrCodes).where(eq(paymentQrCodes.id, row.id)).for('update').limit(1);
      if (!locked || locked.revokedAt) throw rejection('revoked');
      if (locked.expiresAt && locked.expiresAt <= new Date()) throw rejection('expired');
      if (locked.consumedAt) {
        if (locked.consumedBy === userId && locked.consumedClientId === body.clientId && locked.consumedTransferId) {
          return { transferId: locked.consumedTransferId, replayed: true };
        }
        throw rejection('already_used');
      }
      const res = await this.ledger.transfer(transferInput, tx, limits);
      if (!res.ok) {
        if (res.reason === 'insufficient_funds') throw AppError.conflict('Insufficient funds', { reason: 'insufficient_funds' });
        if (res.reason === 'limit_exceeded') throw AppError.conflict('Transfer limit exceeded', { reason: 'limit_exceeded' });
        if (res.reason === 'account_frozen') throw new AppError(403, ErrorCodes.forbidden, 'An account involved is frozen', { reason: 'account_frozen' });
        throw rejection('invalid_counterparty');
      }
      if (locked.singleUse) {
        await tx
          .update(paymentQrCodes)
          .set({ consumedAt: new Date(), consumedBy: userId, consumedClientId: body.clientId, consumedTransferId: res.transferId })
          .where(eq(paymentQrCodes.id, row.id));
      }
      return { transferId: res.transferId, replayed: res.replayed };
    });

    if (!result.replayed) await this.notifyMerchant(org, amountMinor, row.currency, row.id, result.transferId);
    return { transferId: result.transferId, replayed: result.replayed, amountMinor, currency: row.currency, org: { id: org.id, name: org.name } };
  }

  /** `payment` notification to the active members who can see the finances. */
  private async notifyMerchant(org: { id: string; name: string }, amountMinor: number, currency: string, qrId: string, transferId: string): Promise<void> {
    const members = await this.db
      .select({ userId: orgMembers.userId, role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.status, 'active')));
    const recipients = members.filter((m) => roleHasPermission(m.role, 'finance.view'));
    await this.notifications.notifyMany(
      recipients.map((m) => ({
        userId: m.userId,
        category: 'payment' as const,
        title: 'Paiement reçu',
        body: `${org.name} a reçu un paiement de ${(amountMinor / 100).toFixed(2)} ${currency} (sandbox).`,
        data: { kind: 'merchant_payment', orgId: org.id, qrId, transferId },
      })),
    );
  }
}
